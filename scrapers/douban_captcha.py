# ==========================================
# 豆瓣图形点选验证码识别模块
# ==========================================
from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_ddddocr_det = None

_CV2_MATCH_MIN_SCORE = 0.55

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

def _cv2_match_score(haystack_bytes: bytes, needle_bytes: bytes) -> float:
    """在 haystack 中查找 needle，返回 TM_CCOEFF_NORMED 最高分。"""
    if not haystack_bytes or not needle_bytes:
        return -1.0
    hay = cv2.imdecode(np.frombuffer(haystack_bytes, np.uint8), cv2.IMREAD_COLOR)
    needle = cv2.imdecode(np.frombuffer(needle_bytes, np.uint8), cv2.IMREAD_COLOR)
    if hay is None or needle is None:
        return -1.0
    nh, nw = needle.shape[:2]
    hh, hw = hay.shape[:2]
    if nh < 8 or nw < 8:
        return -1.0
    if nh > hh or nw > hw:
        scale = min(hh / nh, hw / nw) * 0.92
        needle = cv2.resize(needle, (max(8, int(nw * scale)), max(8, int(nh * scale))))
        nh, nw = needle.shape[:2]
    if nh > hh or nw > hw:
        return -1.0
    try:
        res = cv2.matchTemplate(hay, needle, cv2.TM_CCOEFF_NORMED)
        return float(res.max()) if res.size else -1.0
    except Exception:
        return -1.0

def _bboxes_from_detection(grid_bytes: bytes) -> list[tuple[float, float]]:
    """用 ddddocr.detection 仅作宫格坐标兜底（不保证语义正确）。"""
    try:
        det = _get_ddddocr_det()
        poses = det.detection(grid_bytes) or []
    except Exception as e:
        logger.debug("ddddocr detection 失败: %s", e)
        return []
    centers: list[tuple[float, float]] = []
    for box in poses:
        if not box or len(box) < 4:
            continue
        x1, y1, x2, y2 = box[:4]
        if (x2 - x1) < 20 or (y2 - y1) < 20:
            continue
        centers.append(((x1 + x2) / 2, (y1 + y2) / 2))
    return centers

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

async def _fetch_image_bytes(page, url: str) -> Optional[bytes]:
    if not url:
        return None
    try:
        resp = await page.context.request.get(url, timeout=5000)
        if resp.ok:
            return await resp.body()
    except Exception:
        pass
    return None

async def _match_prompts_to_targets(
    page,
    prompts: list[dict],
    targets: list[dict],
    grid_bytes: Optional[bytes],
    *,
    deadline: float,
) -> list[tuple[float, float]]:
    """按提示图顺序，用 OpenCV 模板匹配找到对应宫格中心坐标。"""
    click_order: list[tuple[float, float]] = []
    used_targets: set[int] = set()

    for idx, p in enumerate(prompts):
        if time.monotonic() > deadline:
            break
        prompt_bytes = await _fetch_image_bytes(page, p.get("src") or "")
        if not prompt_bytes:
            continue

        best_i = -1
        best_score = -1.0
        best_xy: Optional[tuple[float, float]] = None

        for ti, t in enumerate(targets):
            if ti in used_targets:
                continue
            tile_bytes = await _screenshot_region(
                page,
                t["x"],
                t["y"],
                max(t.get("w") or 56, 56),
                max(t.get("h") or 56, 56),
            )
            score = _cv2_match_score(tile_bytes or b"", prompt_bytes)
            if score > best_score:
                best_score = score
                best_i = ti
                best_xy = (t["x"], t["y"])

        if grid_bytes and best_score < _CV2_MATCH_MIN_SCORE:
            for ti, t in enumerate(targets):
                if ti in used_targets:
                    continue
                tile_bytes = await _screenshot_region(
                    page,
                    t["x"],
                    t["y"],
                    max(t.get("w") or 56, 56),
                    max(t.get("h") or 56, 56),
                )
                score = _cv2_match_score(grid_bytes, prompt_bytes)
                if score > best_score:
                    best_score = score
                    best_i = ti
                    best_xy = (t["x"], t["y"])

        if best_xy and best_score >= _CV2_MATCH_MIN_SCORE and best_i >= 0:
            used_targets.add(best_i)
            click_order.append(best_xy)
            logger.info(
                "豆瓣点选匹配[%s]: score=%.3f pos=(%.0f,%.0f)",
                idx,
                best_score,
                best_xy[0],
                best_xy[1],
            )
        else:
            logger.warning(
                "豆瓣点选匹配[%s]失败: best_score=%.3f (阈值 %.2f)",
                idx,
                best_score,
                _CV2_MATCH_MIN_SCORE,
            )

    return click_order

async def _submit_captcha(page) -> None:
    await _human_pause(200, 500)
    try:
        submit = page.locator(
            'button:has-text("验证"), button:has-text("提交"), .geetest_commit, .captcha-submit'
        ).first
        if await submit.count() > 0:
            await submit.click(timeout=2000)
    except Exception:
        pass
    await asyncio.sleep(0.8)

async def solve_captcha_playwright(page, *, budget_sec: float = 8.0) -> bool:
    """按提示顺序点击宫格（OpenCV 模板匹配，不用错误 URL 对齐）。"""
    deadline = _deadline(budget_sec)
    if not await is_douban_captcha_page(page):
        return True

    prompts = await _collect_prompt_images(page)
    targets = await _collect_click_targets(page)
    if not targets:
        logger.warning("豆瓣点选(Playwright): 未找到可点击宫格元素")
        return False

    container = page.locator("#captcha, .geetest_panel, .captcha-box, .captcha").first
    grid_bytes = None
    if await container.count() > 0:
        try:
            grid_bytes = await container.screenshot(type="png")
        except Exception:
            grid_bytes = None

    if prompts:
        click_order = await _match_prompts_to_targets(
            page, prompts, targets, grid_bytes, deadline=deadline
        )
        if not click_order:
            logger.warning("豆瓣点选(Playwright): 提示图 %s 个，无一匹配成功", len(prompts))
            return False
        for x, y in click_order:
            if time.monotonic() > deadline:
                return False
            await _human_pause()
            await page.mouse.click(x, y)
        await _submit_captcha(page)
        ok = not await is_douban_captcha_page(page)
        logger.info("豆瓣点选(Playwright): 提交后仍验证页=%s", not ok)
        return ok

    logger.warning("豆瓣点选(Playwright): 无提示图，无法确定点击顺序，跳过盲点")
    return False

async def solve_captcha_ddddocr(page, *, budget_sec: float = 8.0) -> bool:
    """
    点选验证码第二道：OpenCV 模板匹配 + ddddocr.detection 仅作坐标兜底。
    不再使用 slide_match（官方文档明确仅用于滑块）。
    """
    deadline = _deadline(budget_sec)
    if not await is_douban_captcha_page(page):
        return True

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

    if not prompts:
        logger.warning("豆瓣点选(ddddocr路径): 页面上无提示图，ddddocr 无法推断点击顺序")
        return False
    if not targets and grid_bytes:
        for cx, cy in _bboxes_from_detection(grid_bytes)[:12]:
            targets.append({"x": cx, "y": cy, "w": 48, "h": 48, "src": ""})
        if targets:
            logger.info("豆瓣点选: 用 ddddocr.detection 兜底得到 %s 个候选格", len(targets))

    if not targets:
        logger.warning("豆瓣点选(ddddocr路径): 无宫格坐标")
        return False

    click_order = await _match_prompts_to_targets(
        page, prompts, targets, grid_bytes, deadline=deadline
    )

    if not click_order and grid_bytes:
        logger.warning(
            "豆瓣点选: OpenCV 全未命中，拒绝用 detection 盲点（会误触）"
        )
        return False

    for x, y in click_order:
        if time.monotonic() > deadline:
            return False
        await _human_pause()
        await page.mouse.click(x, y)

    if click_order:
        await _submit_captcha(page)
    ok = not await is_douban_captcha_page(page)
    logger.info("豆瓣点选(ddddocr路径): 点击 %s 次，仍验证页=%s", len(click_order), not ok)
    return ok

async def ensure_douban_access(
    page,
    *,
    budget_sec: float = 18.0,
) -> tuple[bool, bool]:
    """
    先 Playwright 路径（OpenCV 模板匹配），再尝试 ddddocr.detection 补宫格坐标后重试。
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
