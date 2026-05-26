# ==========================================
# Letterboxd Cloudflare Turnstile 自动处理
# ==========================================
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from scrapers.playwright_common import apply_stealth

logger = logging.getLogger(__name__)

_CF_BLOCK_TITLE_PARTS = ("Just a moment", "Security check")
_CF_BLOCK_PHRASES = (
    "Enable JavaScript and cookies to continue",
    "gravitational anomaly",
    "请验证您是真人",
    "verify you are human",
    "cf_chl_opt",
)

async def _has_cf_clearance(page) -> bool:
    try:
        cookies = await page.context.cookies()
        return any(c.get("name") == "cf_clearance" for c in cookies)
    except Exception:
        return False

async def _letterboxd_film_page_ready(page) -> bool:
    url = (getattr(page, "url", "") or "").lower()
    if "/film/" in url:
        return True
    try:
        return bool(
            await page.evaluate(
                """() => !!(
                    document.querySelector('.film-header, #content-nav, .film-poster')
                )"""
            )
        )
    except Exception:
        return False

async def _letterboxd_content_visible(page, *, url: str = "") -> bool:
    if await _letterboxd_film_page_ready(page):
        return True

    selectors = (
        "#content-nav",
        ".poster-list",
        ".film-header",
    )
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() > 0 and await loc.is_visible():
                return True
        except Exception:
            continue
    return False

async def is_cloudflare_challenge(page) -> bool:
    try:
        if await _letterboxd_content_visible(page):
            return False
        if await _has_cf_clearance(page):
            return False

        title = (await page.title()) or ""
        if any(p in title for p in _CF_BLOCK_TITLE_PARTS):
            return True

        for text in ("请验证您是真人", "Verify you are human", "gravitational anomaly"):
            try:
                loc = page.locator(f"text={text}").first
                if await loc.count() > 0 and await loc.is_visible():
                    return True
            except Exception:
                continue

        content = await page.content()
        if not content:
            return True
        if any(p in content for p in _CF_BLOCK_PHRASES):
            if "Security check" in content or "请验证您是真人" in content:
                return True
        return False
    except Exception:
        return True

async def _wait_challenge_widget(page, timeout_sec: float = 8.0) -> bool:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        for frame in page.frames:
            u = (frame.url or "").lower()
            if "challenges.cloudflare" in u or "turnstile" in u:
                return True
        for sel in (
            'iframe[src*="challenges.cloudflare"]',
            'iframe[src*="turnstile"]',
            "text=请验证您是真人",
        ):
            try:
                if await page.locator(sel).first.count() > 0:
                    return True
            except Exception:
                pass
        await asyncio.sleep(0.3)
    return False

async def _click_turnstile_in_frame(frame) -> bool:
    selectors = (
        'input[type="checkbox"]',
        '[role="checkbox"]',
        "label.ctp-checkbox-label",
        "#challenge-stage label",
        "#challenge-stage input",
        ".mark",
        "span.cb-lb",
    )
    for sel in selectors:
        try:
            loc = frame.locator(sel).first
            if await loc.count() == 0 or not await loc.is_visible():
                continue
            box = await loc.bounding_box()
            if not box or box.get("width", 0) < 8:
                continue
            await loc.click(timeout=3000, delay=120)
            return True
        except Exception:
            continue
    return False

async def _click_cf_by_iframe_position(page) -> bool:
    for sel in (
        'iframe[src*="challenges.cloudflare"]',
        'iframe[src*="turnstile"]',
        'iframe[title*="Widget"]',
    ):
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0:
                continue
            box = await loc.bounding_box()
            if not box or box.get("width", 0) < 50:
                continue
            x = box["x"] + min(32, max(18, box["width"] * 0.14))
            y = box["y"] + box["height"] / 2
            await page.mouse.move(x, y)
            await asyncio.sleep(0.2)
            await page.mouse.down()
            await asyncio.sleep(0.05)
            await page.mouse.up()
            logger.info("Letterboxd CF: iframe 坐标点击 (%.0f, %.0f)", x, y)
            return True
        except Exception:
            continue
    return False

async def _click_cf_checkbox(page) -> bool:
    if await _click_cf_by_iframe_position(page):
        return True

    for text_sel in ("text=请验证您是真人", "text=Verify you are human"):
        try:
            loc = page.locator(text_sel).first
            if await loc.count() > 0 and await loc.is_visible():
                box = await loc.bounding_box()
                if box:
                    await page.mouse.click(
                        box["x"] - 40,
                        box["y"] + box["height"] / 2,
                        delay=120,
                    )
                    logger.info("Letterboxd CF: 文案左侧坐标点击")
                    return True
        except Exception:
            continue

    for frame in page.frames:
        u = (frame.url or "").lower()
        if "challenges.cloudflare" not in u and "turnstile" not in u:
            continue
        if await _click_turnstile_in_frame(frame):
            logger.info("Letterboxd CF: turnstile frame 内 checkbox 点击")
            return True
        for child in getattr(frame, "child_frames", []) or []:
            if await _click_turnstile_in_frame(child):
                logger.info("Letterboxd CF: 嵌套 frame checkbox 点击")
                return True

    return False

async def _wait_cf_resolved(page, timeout_sec: float) -> bool:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        if await _has_cf_clearance(page):
            logger.info("Letterboxd CF: 已获得 cf_clearance cookie")
            return True
        if await _letterboxd_content_visible(page):
            logger.info("Letterboxd CF: 页面内容已加载")
            return True
        if not await is_cloudflare_challenge(page):
            logger.info("Letterboxd CF: 验证页特征已消失")
            return True
        await asyncio.sleep(0.45)
    return False

async def bypass_cloudflare(
    page,
    *,
    budget_sec: float = 25.0,
) -> bool:
    if not await is_cloudflare_challenge(page):
        return True

    await _wait_challenge_widget(page, timeout_sec=min(8.0, budget_sec * 0.35))
    deadline = time.monotonic() + budget_sec
    click_attempts = 0
    max_clicks = 3

    while time.monotonic() < deadline and click_attempts < max_clicks:
        if await _has_cf_clearance(page) or await _letterboxd_content_visible(page):
            return True
        if not await is_cloudflare_challenge(page):
            return True

        click_attempts += 1
        logger.info("Letterboxd CF: 第 %s 次点击尝试", click_attempts)
        clicked = await _click_cf_checkbox(page)
        if not clicked:
            await asyncio.sleep(0.8)
            continue

        wait_budget = min(12.0, deadline - time.monotonic())
        if wait_budget > 1.0 and await _wait_cf_resolved(page, wait_budget):
            return True

    ok = (
        await _has_cf_clearance(page)
        or await _letterboxd_content_visible(page)
        or not await is_cloudflare_challenge(page)
    )
    if not ok:
        logger.warning("Letterboxd CF: %.1fs 内未通过验证（点击 %s 次）", budget_sec, click_attempts)
    return ok

async def wait_letterboxd_film_redirect(page, *, timeout_sec: float = 12.0) -> bool:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        if await _letterboxd_film_page_ready(page):
            return True
        await asyncio.sleep(0.35)
    return False

async def goto_and_settle(
    page,
    url: str,
    *,
    block_images: bool = True,
    budget_sec: float = 22.0,
    wait_until: str = "domcontentloaded",
) -> bool:
    await apply_stealth(page)

    start = time.monotonic()
    await page.goto(url, wait_until="load", timeout=min(30000, int(budget_sec * 1000)))

    cf_remain = max(6.0, budget_sec * 0.55)
    ok = await bypass_cloudflare(page, budget_sec=cf_remain)
    if not ok:
        return False

    if block_images:

        async def _route(route):
            if route.request.resource_type in ("image", "media", "font"):
                await route.abort()
            else:
                await route.continue_()

        try:
            await page.route("**/*", _route)
        except Exception:
            pass

    remain = max(1.0, budget_sec - (time.monotonic() - start))
    try:
        await page.wait_for_load_state("load", timeout=int(min(remain, 8) * 1000))
    except Exception:
        pass

    film_remain = max(4.0, budget_sec - (time.monotonic() - start))
    if not await wait_letterboxd_film_redirect(page, timeout_sec=film_remain):
        logger.warning("Letterboxd: %.1fs 内未进入 /film/ 页面", film_remain)
        return False

    logger.info("Letterboxd: 影片页就绪 %s", getattr(page, "url", ""))
    return True

async def goto_letterboxd_film_by_ids(
    page,
    *,
    imdb_id: str = "",
    tmdb_id: str = "",
    budget_sec: float = 28.0,
) -> Optional[str]:
    """直接访问 /imdb/tt… 或 /tmdb/…（302 到 /film/slug/）。"""
    candidates: list[str] = []
    if imdb_id:
        imdb_norm = imdb_id if str(imdb_id).startswith("tt") else f"tt{imdb_id}"
        candidates.append(f"https://letterboxd.com/imdb/{imdb_norm}/")
    if tmdb_id:
        candidates.append(f"https://letterboxd.com/tmdb/{tmdb_id}/")

    for url in candidates:
        if await goto_and_settle(page, url, block_images=False, budget_sec=budget_sec):
            final = (getattr(page, "url", "") or "").split("?")[0].rstrip("/")
            if "/film/" in final:
                logger.info("Letterboxd: 直连 ID 命中 %s -> %s", url, final)
                return final

    return None

async def fetch_html_with_browser(
    browser,
    url: str,
    *,
    cookies: Optional[list] = None,
    user_agent: Optional[str] = None,
    budget_sec: float = 22.0,
) -> tuple[Optional[str], bool]:
    from scrapers.playwright_common import pick_viewport

    ctx = await browser.new_context(
        viewport=pick_viewport(),
        user_agent=user_agent,
        locale="en-US",
        timezone_id="America/Los_Angeles",
    )
    page = await ctx.new_page()
    try:
        if cookies:
            await ctx.add_cookies(cookies)
        ok = await goto_and_settle(page, url, budget_sec=budget_sec)
        if not ok:
            return None, True
        return await page.content(), False
    finally:
        await ctx.close()

async def ensure_page_ready(
    page,
    url: Optional[str] = None,
    *,
    budget_sec: float = 25.0,
) -> bool:
    if url:
        await page.goto(url, wait_until="domcontentloaded", timeout=min(15000, int(budget_sec * 1000)))
    return await bypass_cloudflare(page, budget_sec=budget_sec)
