# ==========================================
# Playwright 通用工具模块
# ==========================================
from __future__ import annotations

import random
from typing import Any, Optional

_DEFAULT_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

_STEALTH_INIT = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
window.chrome = window.chrome || { runtime: {} };
Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
"""

async def apply_stealth(page) -> None:
    try:
        await page.add_init_script(_STEALTH_INIT)
    except Exception:
        pass
    try:
        from playwright_stealth import stealth_async  # type: ignore[reportMissingImports]

        await stealth_async(page)
    except Exception:
        pass

def chrome_launch_kwargs(headless: bool = True) -> dict[str, Any]:
    args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--window-size=1280,720",
        "--lang=zh-CN,zh",
    ]
    kwargs: dict[str, Any] = {"headless": headless, "args": args}
    try:
        kwargs["channel"] = "chrome"
    except Exception:
        pass
    return kwargs

def pick_viewport() -> dict[str, int]:
    base = random.choice([(1280, 720), (1366, 768), (1440, 900)])
    return {
        "width": base[0] + random.randint(-40, 40),
        "height": base[1] + random.randint(-30, 30),
    }

async def new_stealth_context(
    browser,
    *,
    user_agent: Optional[str] = None,
    locale: str = "zh-CN",
    timezone_id: str = "Asia/Shanghai",
):
    ua = user_agent or random.choice(_DEFAULT_USER_AGENTS)
    context = await browser.new_context(
        viewport=pick_viewport(),
        user_agent=ua,
        locale=locale,
        timezone_id=timezone_id,
        java_script_enabled=True,
        has_touch=False,
        is_mobile=False,
        ignore_https_errors=True,
    )
    page = await context.new_page()
    page.set_default_timeout(15000)
    await apply_stealth(page)
    return context, page
