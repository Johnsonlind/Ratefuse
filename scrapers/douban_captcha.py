# ==========================================
# 豆瓣图形点选验证码识别模块
# ==========================================
from __future__ import annotations

import asyncio
import io
import random
import re
import time
from typing import Optional

_ddddocr_det = None
_ddddocr_slide = None

def _deadline(budget_sec: float) -> float:
    return time.monotonic() + budget_sec

def is_douban_captcha_html(html: str, url: str = "", title: str = "") -> bool:
    """仅识别真实验证页，避免搜索页脚本里的「安全验证」字样误判。"""
    u = (url or "").lower()
    if "sec.douban.com" in u:
        return True
    h = html or ""
    if "你访问豆瓣的方式有点像机器人程序" in h and "点击证明" in h:
        return True
    if "请依次点击" in h or "请依次点击对应的" in h:
        return True
    if "geetest" in h.lower() and ("captcha" in h.lower() or "点选" in h):
        return True
    t = (title or "").strip()
    if t in ("豆瓣", "豆瓣网") and "点击证明" in h:
        return True
    return False

def is_douban_hard_block_html(html: str, url: str = "", page_title: str = "") -> bool:
    """明确的风控/限流页（与验证码区分）。"""
    c = (html or "").lower()
    u = (url or "").lower()
    t = (page_title or "").lower()
    hard = (
        "error code: 008",
        "你访问豆瓣的方式有点像机器人程序",
        "有异常请求从你的ip发出",
        "请求过于频繁",
        "访问太频繁",
    )
    if any(s in c or s in t for s in hard):
        return True
    if "sec.douban.com" in u and "subject" not in u:
        return True
    return False

async def is_douban_captcha_page(page) -> bool:
    try:
        html = await page.content()
        url = str(getattr(page, "url", "") or "")
        title = await page.title()
        return is_douban_captcha_html(html, url, title)
    except Exception:
        return False

async def _human_pause(min_ms: int = 120, max_ms: int = 380) -> None:
    await asyncio.sleep(random.uniform(min_ms / 1000.0, max_ms / 1000.0))

def _get_ddddocr_det():
    global _ddddocr_det
    if _ddddocr_det is None:
        import ddddocr

        _ddddocr_det = ddddocr.DdddOcr(det=True, ocr=False, show_ad=False)
    return _ddddocr_det

def _get_ddddocr_slide():
    global _ddddocr_slide
    if _ddddocr_slide is None:
        import ddddocr

        _ddddocr_slide = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)
    return _ddddocr_slide

async def _collect_click_targets(page) -> list[dict]:
    return await page.evaluate(
        """() => {
            const sel = [
                '#captcha .captcha-pic img',
                '.geetest_widget img.geetest_item_img',
                '.captcha_click img',
                '.captcha-pic-item img',
                '#captcha img',
                '.captcha img',
            ].join(',');
            const nodes = Array.from(document.querySelectorAll(sel));
            const out = [];
            const seen = new Set();
            for (const el of nodes) {
                const r = el.getBoundingClientRect();
                if (r.width < 20 || r.height < 20) continue;
                const key = Math.round(r.x) + ',' + Math.round(r.y);
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    x: r.x + r.width / 2,
                    y: r.y + r.height / 2,
                    src: el.src || '',
                    w: r.width,
                    h: r.height,
                });
            }
            return out;
        }"""
    )

async def _collect_prompt_images(page) -> list[dict]:
    return await page.evaluate(
        """() => {
            const sel = [
                '.captcha-prompt img',
                '#captcha .hint img',
                '.geetest_ques_tips img',
                '.captcha-order img',
            ].join(',');
            const nodes = Array.from(document.querySelectorAll(sel));
            return nodes.map((el, i) => {
                const r = el.getBoundingClientRect();
                return { i, src: el.src || '', w: r.width, h: r.height };
            }).filter(x => x.src);
        }"""
    )

async def _element_screenshot_bytes(page, selector: str) -> Optional[bytes]:
    try:
        loc = page.locator(selector).first
        if await loc.count() == 0:
            return None
        return await loc.screenshot(type="png")
    except Exception:
        return None

async def _screenshot_region(page, x: float, y: float, w: float, h: float) -> Optional[bytes]:
    try:
        clip = {
            "x": max(0, x - w / 2),
            "y": max(0, y - h / 2),
            "width": w,
            "height": h,
        }
        return await page.screenshot(type="png", clip=clip)
    except Exception:
        return None

async def solve_captcha_playwright(page, *, budget_sec: float = 8.0) -> bool:
    """Click captcha tiles following on-page prompt order."""
    deadline = _deadline(budget_sec)
    if not await is_douban_captcha_page(page):
        return True

    prompts = await _collect_prompt_images(page)
    targets = await _collect_click_targets(page)
    if not targets:
        return False

    if prompts:
        for p in prompts:
            if time.monotonic() > deadline:
                return False
            px = None
            for t in targets:
                if p.get("src") and t.get("src") and p["src"] == t["src"]:
                    px, py = t["x"], t["y"]
                    break
            if px is None and len(targets) > 0:
                t = targets[min(p.get("i", 0), len(targets) - 1)]
                px, py = t["x"], t["y"]
            if px is not None:
                await _human_pause()
                await page.mouse.click(px, py)
        await _human_pause(200, 500)
        try:
            submit = page.locator(
                'button:has-text("验证"), button:has-text("提交"), .geetest_commit, .captcha-submit'
            ).first
            if await submit.count() > 0:
                await submit.click(timeout=2000)
        except Exception:
            pass
        await asyncio.sleep(0.6)
        return not await is_douban_captcha_page(page)

    targets.sort(key=lambda t: (t.get("w") or 0) * (t.get("h") or 0), reverse=True)
    for t in targets[:4]:
        if time.monotonic() > deadline:
            break
        await _human_pause()
        await page.mouse.click(t["x"], t["y"])
    await asyncio.sleep(0.8)
    return not await is_douban_captcha_page(page)

async def solve_captcha_ddddocr(page, *, budget_sec: float = 8.0) -> bool:
    """Match prompt icon crops to grid tiles via ddddocr slide_match."""
    deadline = _deadline(budget_sec)
    if not await is_douban_captcha_page(page):
        return True

    try:
        det = _get_ddddocr_det()
        slide = _get_ddddocr_slide()
    except Exception:
        return False

    container = page.locator("#captcha, .geetest_panel, .captcha-box, .captcha").first
    grid_bytes = None
    if await container.count() > 0:
        try:
            grid_bytes = await container.screenshot(type="png")
        except Exception:
            grid_bytes = None
    if not grid_bytes:
        grid_bytes = await page.screenshot(type="png", full_page=False)

    prompts = await _collect_prompt_images(page)
    targets = await _collect_click_targets(page)
    if not targets or not prompts:
        return await solve_captcha_playwright(page, budget_sec=max(2.0, deadline - time.monotonic()))

    click_order: list[tuple[float, float]] = []
    for p in prompts:
        if time.monotonic() > deadline:
            break
        prompt_bytes = None
        if p.get("src"):
            try:
                resp = await page.context.request.get(p["src"], timeout=5000)
                if resp.ok:
                    prompt_bytes = await resp.body()
            except Exception:
                prompt_bytes = None
        if not prompt_bytes:
            continue

        best_xy = None
        best_score = -1.0
        for t in targets:
            tile = await _screenshot_region(page, t["x"], t["y"], max(t.get("w") or 48, 48), max(t.get("h") or 48, 48))
            if not tile:
                continue
            try:
                res = slide.slide_match(prompt_bytes, tile, simple_target=True)
                target = res.get("target") if isinstance(res, dict) else None
                if target and len(target) >= 4:
                    score = (target[2] - target[0]) * (target[3] - target[1])
                    if score > best_score:
                        best_score = score
                        best_xy = (t["x"], t["y"])
            except Exception:
                continue
        if best_xy:
            click_order.append(best_xy)

    if not click_order:
        poses = det.detection(grid_bytes) if grid_bytes else []
        if len(poses) >= len(prompts):
            for box in poses[: len(prompts)]:
                x1, y1, x2, y2 = box
                click_order.append(((x1 + x2) / 2, (y1 + y2) / 2))

    for x, y in click_order:
        if time.monotonic() > deadline:
            return False
        await _human_pause()
        await page.mouse.click(x, y)

    if click_order:
        await _human_pause(250, 600)
        try:
            submit = page.locator('button:has-text("验证"), .geetest_commit').first
            if await submit.count() > 0:
                await submit.click(timeout=2000)
        except Exception:
            pass
        await asyncio.sleep(0.8)
    return not await is_douban_captcha_page(page)

async def ensure_douban_access(
    page,
    *,
    budget_sec: float = 18.0,
) -> tuple[bool, bool]:
    """
    Try Playwright captcha clicks, then ddddocr.
    Returns (access_ok, captcha_exhausted).
    captcha_exhausted=True only when both solvers failed while still on captcha.
    """
    if not await is_douban_captcha_page(page):
        return True, False

    total = budget_sec
    t0 = time.monotonic()
    pw_budget = min(8.0, total * 0.45)
    if await solve_captcha_playwright(page, budget_sec=pw_budget):
        if not await is_douban_captcha_page(page):
            return True, False

    remain = max(2.0, total - (time.monotonic() - t0))
    if await solve_captcha_ddddocr(page, budget_sec=min(8.0, remain)):
        if not await is_douban_captcha_page(page):
            return True, False

    still = await is_douban_captcha_page(page)
    return (not still), still

async def goto_douban_and_ensure(
    page,
    url: str,
    *,
    budget_sec: float = 18.0,
    wait_until: str = "domcontentloaded",
) -> tuple[bool, bool, Optional[str]]:
    """Navigate and solve captcha if needed. Returns (ok, captcha_exhausted, html)."""
    from scrapers.playwright_common import apply_stealth

    await apply_stealth(page)
    start = time.monotonic()
    await page.goto(url, wait_until=wait_until, timeout=min(12000, int(budget_sec * 1000)))
    remain = max(3.0, budget_sec - (time.monotonic() - start))
    ok, exhausted = await ensure_douban_access(page, budget_sec=remain)
    html = await page.content() if ok else None
    return ok, exhausted, html
