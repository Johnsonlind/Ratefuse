# ==========================================
# 浏览器资源池模块
# ==========================================
import asyncio
import hashlib
import logging
import threading
import time
from typing import List, Optional
from playwright.async_api import async_playwright, Browser, Playwright

logger = logging.getLogger(__name__)

_DOUBAN_MIN_INTERVAL_SEC = 4.0
_douban_throttle_lock = threading.Lock()
_douban_throttle_last: float = 0.0

_DOUBAN_BLOCKED_UNTIL: float = 0.0
_douban_block_lock = threading.Lock()

def douban_is_blocked() -> tuple[bool, float]:
    """返回(是否处于冷却期, 剩余秒数)"""
    with _douban_block_lock:
        now = time.monotonic()
        remain = _DOUBAN_BLOCKED_UNTIL - now
        return (remain > 0), max(remain, 0.0)

def mark_douban_rate_limited(cooldown_sec: float = 600.0) -> None:
    """标记豆瓣进入冷却期（默认 10 分钟）。"""
    global _DOUBAN_BLOCKED_UNTIL
    with _douban_block_lock:
        _DOUBAN_BLOCKED_UNTIL = max(_DOUBAN_BLOCKED_UNTIL, time.monotonic() + float(cooldown_sec))

_DOUBAN_SAME_COOKIE_MIN_GAP_SEC = 10.0
_cookie_playwright_lock = threading.Lock()
_douban_cookie_last_playwright_start: dict[str, float] = {}

douban_playwright_session_semaphore = asyncio.Semaphore(3)

_DOUBAN_START_SEGMENT_CAPACITY = 3
_DOUBAN_START_SEGMENT_INTERVAL_SEC = 10.0
_douban_start_segment_lock = asyncio.Lock()
_douban_start_segment_tokens: int = _DOUBAN_START_SEGMENT_CAPACITY
_douban_start_segment_last_refill: float = time.monotonic()

def wait_turn() -> None:
    global _douban_throttle_last
    with _douban_throttle_lock:
        now = time.monotonic()
        delay = _DOUBAN_MIN_INTERVAL_SEC - (now - _douban_throttle_last)
        if delay > 0:
            time.sleep(delay)
        _douban_throttle_last = time.monotonic()

async def wait_turn_async() -> None:
    await asyncio.to_thread(wait_turn)

def _douban_cookie_key(cookie: Optional[str]) -> str:
    ck = (cookie or "").strip()
    if not ck:
        return "__anon__"
    return hashlib.sha256(ck.encode("utf-8")).hexdigest()[:24]

def wait_before_douban_playwright(cookie: Optional[str]) -> None:
    global _douban_throttle_last
    with _douban_throttle_lock:
        now = time.monotonic()
        delay = _DOUBAN_MIN_INTERVAL_SEC - (now - _douban_throttle_last)
        if delay > 0:
            time.sleep(delay)
        _douban_throttle_last = time.monotonic()

    key = _douban_cookie_key(cookie)
    with _cookie_playwright_lock:
        now = time.monotonic()
        last = _douban_cookie_last_playwright_start.get(key, 0.0)
        gap = _DOUBAN_SAME_COOKIE_MIN_GAP_SEC - (now - last)
        if gap > 0:
            logger.info("豆瓣同账号冷却 %.1fs（降低风控概率）", gap)
            time.sleep(gap)
        _douban_cookie_last_playwright_start[key] = time.monotonic()

async def wait_before_douban_playwright_async(cookie: Optional[str]) -> None:
    global _douban_start_segment_tokens, _douban_start_segment_last_refill
    while True:
        async with _douban_start_segment_lock:
            now = time.monotonic()
            elapsed = now - _douban_start_segment_last_refill
            if elapsed >= _DOUBAN_START_SEGMENT_INTERVAL_SEC:
                _douban_start_segment_last_refill = now
                _douban_start_segment_tokens = _DOUBAN_START_SEGMENT_CAPACITY
                elapsed = 0.0

            if _douban_start_segment_tokens > 0:
                _douban_start_segment_tokens -= 1
                break

            sleep_for = _DOUBAN_START_SEGMENT_INTERVAL_SEC - elapsed

        await asyncio.sleep(max(sleep_for, 0.05))

    await asyncio.to_thread(wait_before_douban_playwright, cookie)

class BrowserPool:
    def __init__(self, max_browsers=5, max_contexts_per_browser=3, max_pages_per_context=5):
        self.max_browsers = max_browsers
        
        self.playwright: Optional[Playwright] = None
        self.browsers: List[Browser] = []
        self.available_browsers = asyncio.Queue()
        self.lock = asyncio.Lock()
        self.initialized = False
        
        self.total_requests = 0
        self.failed_requests = 0
        self.browser_crashes = 0
        
    async def initialize(self):
        if self.initialized:
            return
            
        async with self.lock:
            if self.initialized:
                return
                
            logger.info("正在初始化浏览器池...")
            self.playwright = await async_playwright().start()
            
            for i in range(self.max_browsers):
                try:
                    browser = await self.playwright.chromium.launch(
                        headless=True,
                        args=[
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-gpu',
                            '--disable-extensions',
                            '--disable-audio-output',
                            '--disable-web-security',
                            '--disable-features=site-per-process',
                            '--disable-site-isolation-trials',
                            '--disable-blink-features=AutomationControlled',
                            '--window-size=1280,720',
                        ]
                    )
                    self.browsers.append(browser)
                    await self.available_browsers.put(browser)
                    logger.info(f"浏览器 {i+1}/{self.max_browsers} 已启动")
                except Exception as e:
                    logger.error(f"启动浏览器 {i+1} 失败: {str(e)}")
                    
            self.initialized = True
            logger.info(f"浏览器池初始化完成，共 {len(self.browsers)} 个浏览器实例")
            
    async def get_browser(self) -> Browser:
        if not self.initialized:
            await self.initialize()
            
        return await self.available_browsers.get()
        
    async def release_browser(self, browser: Browser):
        await self.available_browsers.put(browser)
        
    async def execute_in_browser(self, callback, *args, **kwargs):
        self.total_requests += 1
        browser = await self.get_browser()
        
        try:
            result = await callback(browser, *args, **kwargs)
            return result
        except Exception as e:
            self.failed_requests += 1
            logger.error(f"浏览器操作失败: {str(e)}")
            
            try:
                context = await browser.new_context()
                await context.close()
            except Exception:
                self.browser_crashes += 1
                logger.warning("检测到浏览器崩溃，正在替换...")
                try:
                    self.browsers.remove(browser)
                    new_browser = await self.playwright.chromium.launch(
                        headless=True,
                        args=[
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-blink-features=AutomationControlled',
                            '--window-size=1280,720',
                        ]
                    )
                    self.browsers.append(new_browser)
                    browser = new_browser
                except Exception as e2:
                    logger.error(f"替换崩溃的浏览器失败: {str(e2)}")
            
            raise e
        finally:
            await self.release_browser(browser)
            
    async def cleanup(self):
        logger.info("正在清理浏览器池...")
        for browser in self.browsers:
            try:
                await browser.close()
            except Exception as e:
                logger.error(f"关闭浏览器失败: {str(e)}")
                
        if self.playwright:
            await self.playwright.stop()
            
        self.initialized = False
        logger.info("浏览器池已清理")
        
    def get_stats(self):
        return {
            "total_requests": self.total_requests,
            "failed_requests": self.failed_requests,
            "browser_crashes": self.browser_crashes,
            "active_browsers": len(self.browsers),
            "available_browsers": self.available_browsers.qsize()
        }

browser_pool = BrowserPool(max_browsers=5, max_contexts_per_browser=3, max_pages_per_context=5)
