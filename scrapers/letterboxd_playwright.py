# ==========================================
# Letterboxd Cloudflare Turnstile 自动处理
# ==========================================
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from typing import Optional
from urllib.parse import urlparse

from scrapers.playwright_common import apply_stealth

logger = logging.getLogger(__name__)

_LETTERBOXD_GOTO_TIMEOUT_MS = int(
    os.environ.get("LETTERBOXD_GOTO_TIMEOUT_MS", "45000")
)

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

def _is_cf_challenge_url(url: str) -> bool:
    u = (url or "").lower()
    return "__cf_chl" in u or "cf_chl_rt_tk" in u

def canonical_letterboxd_film_url(url: str) -> Optional[str]:
    """去掉 Cloudflare 等查询参数，得到干净的 /film/slug/ URL。"""
    if not url:
        return None
    raw = url.split("#", 1)[0]
    m = re.search(
        r"https?://(?:www\.)?letterboxd\.com/film/([a-z0-9\-]+)",
        raw,
        flags=re.IGNORECASE,
    )
    if m:
        return f"https://letterboxd.com/film/{m.group(1)}/"
    path = urlparse(raw).path if "://" in raw else raw
    m2 = re.search(r"/film/([a-z0-9\-]+)", path, flags=re.IGNORECASE)
    if m2:
        return f"https://letterboxd.com/film/{m2.group(1)}/"
    return None

async def _letterboxd_has_film_body(page) -> bool:
    """影片页 DOM（非 CF 中转页）。"""
    try:
        return bool(
            await page.evaluate(
                """() => {
                    if (document.querySelector(
                        'span.average-rating, .display-rating .average-rating, #rating-histogram'
                    )) return true;
                    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                    for (const s of scripts) {
                        const t = (s.textContent || '');
                        if (t.includes('aggregateRating') && t.includes('ratingValue')) return true;
                    }
                    const h = document.querySelector(
                        'h1.headline-1, h1.film-title, h1[itemprop="name"]'
                    );
                    if (!h) return false;
                    const title = (h.textContent || '').trim();
                    if (!title || /your life in film|just a moment|security check/i.test(title)) {
                        return false;
                    }
                    return !!document.querySelector('.film-header, #content-nav, .film-poster');
                }"""
            )
        )
    except Exception:
        return False

async def _letterboxd_film_page_ready(page) -> bool:
    url = getattr(page, "url", "") or ""
    if _is_cf_challenge_url(url):
        return False
    if "/film/" not in url.lower():
        return False
    return await _letterboxd_has_film_body(page)

async def _letterboxd_content_visible(page, *, url: str = "") -> bool:
    cur = (url or getattr(page, "url", "") or "")
    if _is_cf_challenge_url(cur):
        return False
    if "/film/" in cur.lower():
        return await _letterboxd_film_page_ready(page)

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
        if _is_cf_challenge_url(getattr(page, "url", "") or ""):
            return True
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
    target = canonical_letterboxd_film_url(getattr(page, "url", "") or "")
    return await await_clean_letterboxd_film_page(
        page, target or "", timeout_sec=timeout_sec
    )

async def await_clean_letterboxd_film_page(
    page,
    target_url: str,
    *,
    timeout_sec: float = 12.0,
) -> bool:
    """等待并落到无 CF 查询参数的影片页（可重新 goto 干净 URL）。"""
    clean = canonical_letterboxd_film_url(target_url) or canonical_letterboxd_film_url(
        getattr(page, "url", "") or ""
    )
    if not clean:
        return False

    deadline = time.monotonic() + timeout_sec
    reloads = 0
    max_reloads = 2

    while time.monotonic() < deadline:
        cur = getattr(page, "url", "") or ""
        remain = deadline - time.monotonic()

        if _is_cf_challenge_url(cur) or await is_cloudflare_challenge(page):
            if remain > 2.0:
                await bypass_cloudflare(page, budget_sec=min(14.0, remain * 0.6))
            if reloads < max_reloads and remain > 1.5:
                reloads += 1
                try:
                    await page.goto(
                        clean,
                        wait_until="domcontentloaded",
                        timeout=int(min(20000, remain * 1000)),
                    )
                except Exception:
                    pass
            await asyncio.sleep(0.45)
            continue

        if await _letterboxd_film_page_ready(page):
            cur_clean = canonical_letterboxd_film_url(cur) or clean
            if cur_clean and cur != cur_clean and "?" in cur and reloads < max_reloads:
                reloads += 1
                try:
                    await page.goto(
                        cur_clean,
                        wait_until="domcontentloaded",
                        timeout=int(min(15000, remain * 1000)),
                    )
                except Exception:
                    pass
                await asyncio.sleep(0.35)
                if await _letterboxd_film_page_ready(page):
                    return True
            return True

        if reloads < max_reloads and remain > 1.5:
            reloads += 1
            try:
                await page.goto(
                    clean,
                    wait_until="domcontentloaded",
                    timeout=int(min(20000, remain * 1000)),
                )
            except Exception:
                pass
        await asyncio.sleep(0.35)

    return await _letterboxd_film_page_ready(page)

async def _install_lightweight_routes(page) -> None:
    async def _route(route):
        if route.request.resource_type in ("image", "media", "font"):
            await route.abort()
        else:
            await route.continue_()

    try:
        await page.route("**/*", _route)
    except Exception:
        pass

async def _goto_with_fallback(
    page,
    url: str,
    *,
    wait_until: str,
    timeout_ms: int,
) -> bool:
    strategies = [wait_until]
    if wait_until != "commit":
        strategies.append("commit")
    last_err: Optional[Exception] = None
    for idx, strategy in enumerate(strategies):
        per_attempt = timeout_ms if idx == 0 else max(12000, timeout_ms // 2)
        try:
            await page.goto(url, wait_until=strategy, timeout=per_attempt)
            if strategy != wait_until:
                logger.info("Letterboxd: goto 使用 %s 回退成功", strategy)
            return True
        except Exception as exc:
            last_err = exc
            if "Timeout" not in str(exc):
                raise
            logger.warning(
                "Letterboxd: goto wait_until=%s 超时 (%sms)",
                strategy,
                per_attempt,
            )
    if last_err:
        raise last_err
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

    if block_images:
        await _install_lightweight_routes(page)

    start = time.monotonic()
    goto_timeout_ms = min(
        _LETTERBOXD_GOTO_TIMEOUT_MS,
        max(15000, int(budget_sec * 1000)),
    )
    try:
        await _goto_with_fallback(
            page,
            url,
            wait_until=wait_until,
            timeout_ms=goto_timeout_ms,
        )
    except Exception:
        return False

    cf_remain = max(6.0, budget_sec * 0.55)
    ok = await bypass_cloudflare(page, budget_sec=cf_remain)
    if not ok:
        return False

    remain = max(1.0, budget_sec - (time.monotonic() - start))
    try:
        await page.wait_for_load_state(
            "domcontentloaded",
            timeout=int(min(remain, 6) * 1000),
        )
    except Exception:
        pass

    film_remain = max(4.0, budget_sec - (time.monotonic() - start))
    clean_target = canonical_letterboxd_film_url(url) or canonical_letterboxd_film_url(
        getattr(page, "url", "") or ""
    )
    if not await await_clean_letterboxd_film_page(
        page, clean_target or url, timeout_sec=film_remain
    ):
        logger.warning("Letterboxd: %.1fs 内未进入干净的 /film/ 页面", film_remain)
        return False

    final_url = canonical_letterboxd_film_url(getattr(page, "url", "") or "") or getattr(
        page, "url", ""
    )
    logger.info("Letterboxd: 影片页就绪 %s", final_url)
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
