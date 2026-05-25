# ==========================================
# 豆瓣图形点选验证码（通义千问 Qwen3.6-Flash 版）
# ==========================================
from __future__ import annotations

import asyncio
import logging
import os
import random
import time
import base64
import json
from datetime import datetime
from typing import Any, Optional, Union

import dashscope
from dashscope import MultiModalConversation

logger = logging.getLogger(__name__)

DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
dashscope.base_http_api_url = "https://dashscope.aliyuncs.com/api/v1"
MODEL_ID = "qwen3.6-flash"

CAPTURE_SAVE_DIR = "./douban_captcha_snapshot"
CAPTURE_IMG_TYPE = "png"

NORM_RANGE = 1000

def _save_page_snapshot(img_bytes: bytes, reason: str = "unknown") -> Optional[str]:
    if not img_bytes:
        return None
    os.makedirs(CAPTURE_SAVE_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    save_path = os.path.join(CAPTURE_SAVE_DIR, f"{ts}_{reason}.{CAPTURE_IMG_TYPE}")
    try:
        with open(save_path, "wb") as f:
            f.write(img_bytes)
        logger.info("页面截图已保存: %s", save_path)
        return save_path
    except Exception as e:
        logger.error("保存截图失败: %s", e)
        return None

async def _capture_and_save(page, reason: str) -> None:
    try:
        root = page if hasattr(page, "screenshot") else page.page
        img = await root.screenshot(type=CAPTURE_IMG_TYPE)
        _save_page_snapshot(img, reason=reason)
    except Exception as e:
        logger.debug("截图失败(%s): %s", reason, e)

def _all_contexts(page) -> list:
    out = [page]
    try:
        out.extend(page.frames)
    except Exception:
        pass
    return out

def _root_page(ctx):
    return ctx if hasattr(ctx, "context") else getattr(ctx, "page", ctx)

async def _human_pause(min_ms: int = 120, max_ms: int = 380) -> None:
    await asyncio.sleep(random.uniform(min_ms / 1000.0, max_ms / 1000.0))

async def _click_prove_button(page) -> bool:
    selectors = (
        "#tcaptcha_btn",
        'button:has-text("点击证明")',
        'a:has-text("点击证明")',
    )
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0:
                continue
            await loc.scroll_into_view_if_needed(timeout=2000)
            await loc.click(timeout=4000, force=True)
            await _human_pause(400, 700)
            logger.info("已点击「点击证明」: %s", sel)
            return True
        except Exception as e:
            logger.debug("点击证明(%s)失败: %s", sel, e)
    await _capture_and_save(page, "click_prove_btn_failed")
    return False

async def _capture_verification_panel(ctx) -> Optional[bytes]:
    for selector in ["#bodyWrap", "#slideBg"]:
        try:
            loc = ctx.locator(selector).first
            if await loc.count() > 0 and await loc.is_visible():
                img_bytes = await loc.screenshot(type="png")
                if img_bytes:
                    logger.info("已截取验证码面板: %s", selector)
                    return img_bytes
        except Exception:
            continue
    return None

async def _call_qwen_for_captcha(image_bytes: bytes) -> Optional[list[tuple[int, int]]]:
    base64_image = base64.b64encode(image_bytes).decode('utf-8')
    image_url = f"data:image/png;base64,{base64_image}"

    prompt = f"""
你是一个验证码识别助手。下面是一张点选验证码图片，上方有一排提示图标（或文字），下方是包含多个图标的网格。
请按顺序点击与提示图标完全匹配的网格位置。
- 输出格式：仅返回一个 JSON 对象，格式为 {{"clicks": [[x1,y1], [x2,y2], ...]}}
- 坐标归一化到 0-{NORM_RANGE}，左上角为 (0,0)，右下角为 ({NORM_RANGE},{NORM_RANGE})
- 不要输出任何解释或额外文字，只输出 JSON
- 注意：提示图标可能为图形或数字，请仔细匹配
"""
    messages = [
        {
            "role": "user",
            "content": [
                {"image": image_url},
                {"text": prompt}
            ]
        }
    ]

    try:
        response = MultiModalConversation.call(
            api_key=DASHSCOPE_API_KEY,
            model=MODEL_ID,
            messages=messages,
            temperature=0.1,
        )

        if response.status_code == 200:
            content = response.output.choices[0].message.content[0]["text"]
            content = content.replace('```json', '').replace('```', '').strip()
            data = json.loads(content)
            clicks = data.get("clicks", [])
            if clicks and len(clicks) > 0:
                normalized = []
                for x, y in clicks:
                    nx = max(0, min(NORM_RANGE, int(x)))
                    ny = max(0, min(NORM_RANGE, int(y)))
                    normalized.append((nx, ny))
                logger.info("模型返回归一化坐标: %s", normalized)
                return normalized
            else:
                logger.warning("模型返回的坐标列表为空")
                return None
        else:
            logger.error("API 调用失败: %s - %s", response.status_code, response.message)
            return None
    except Exception as e:
        logger.exception("调用通义千问时发生异常: %s", e)
        return None

async def _click_on_slide_bg_by_norm(
    ctx,
    norm_coords: list[tuple[int, int]],
    page
) -> None:
    slide = ctx.locator("#slideBg").first
    box = await slide.bounding_box()
    if not box:
        raise RuntimeError("无法获取 #slideBg 的位置信息")

    w, h = box["width"], box["height"]
    mouse_page = _root_page(page)

    for i, (nx, ny) in enumerate(norm_coords):
        px = int(nx / NORM_RANGE * w)
        py = int(ny / NORM_RANGE * h)
        px = max(5, min(px, int(w) - 5))
        py = max(5, min(py, int(h) - 5))
        abs_x = box["x"] + px
        abs_y = box["y"] + py

        logger.info("点击 %d: 归一化(%d,%d) -> 实际(%d,%d) -> 绝对(%.1f,%.1f)",
                    i+1, nx, ny, px, py, abs_x, abs_y)

        await mouse_page.mouse.move(abs_x, abs_y)
        await _human_pause(80, 160)
        await mouse_page.mouse.click(abs_x, abs_y, delay=random.randint(60, 140))
        await _human_pause(280, 520)

        try:
            marks = await ctx.locator(".tc-click-mark").count()
            logger.info("点击后 .tc-click-mark 数量: %s", marks)
        except Exception:
            pass

async def _submit_tencent(ctx, page) -> bool:
    await _human_pause(300, 500)
    root = _root_page(page)
    targets = [ctx, root, *_all_contexts(root)]

    selectors = (
        ".verify-btn.show",
        ".verify-btn",
        "#bodyWrap .verify-btn",
        ".tcaptcha-embed .verify-btn",
        'div.verify-btn:has-text("确定")',
        'button:has-text("确定")',
        "#verifyBtn",
    )
    for target in targets:
        for sel in selectors:
            try:
                loc = target.locator(sel).first
                if await loc.count() == 0:
                    continue
                await loc.scroll_into_view_if_needed(timeout=1500)
                await loc.click(timeout=4000, force=True)
                logger.info("已点击确定: %s @ %s", sel, getattr(target, "url", "main"))
                await asyncio.sleep(1.2)
                return True
            except Exception as e:
                logger.debug("提交(%s)失败: %s", sel, e)

        try:
            clicked = await target.evaluate(
                """() => {
                    const candidates = document.querySelectorAll(
                        '.verify-btn, #verifyBtn, button, div[role="button"]'
                    );
                    for (const el of candidates) {
                        const t = (el.textContent || '').trim();
                        if (t === '确定' || t.includes('确定')) {
                            el.click();
                            return true;
                        }
                    }
                    const btn = document.querySelector('.verify-btn');
                    if (btn) { btn.click(); return true; }
                    return false;
                }"""
            )
            if clicked:
                logger.info("已通过 JS 点击确定 @ %s", getattr(target, "url", "main"))
                await asyncio.sleep(1.2)
                return True
        except Exception:
            pass
    return False

async def _resolve_captcha_ctx(page, wait_sec=12.0):
    deadline = time.monotonic() + wait_sec
    while time.monotonic() < deadline:
        for ctx in _all_contexts(page):
            try:
                loc = ctx.locator("#slideBg").first
                if await loc.count() > 0 and await loc.is_visible():
                    logger.info("找到验证码上下文")
                    return ctx
            except Exception:
                continue
        await asyncio.sleep(0.25)
    return None

async def is_douban_captcha_page(page) -> bool:
    try:
        for ctx in _all_contexts(page):
            for sel in ("#bodyWrap", "#slideBg", ".tc-instruction-icon", "#tcaptcha_btn"):
                loc = ctx.locator(sel).first
                if await loc.count() > 0 and await loc.is_visible():
                    return True
        html = await page.content()
        url = str(getattr(page, "url", "") or "")
        title = await page.title()
        if "sec.douban.com" in url:
            return True
        if "turing.captcha.qcloud.com" in html or "tcaptcha" in html.lower():
            return True
        if "你访问豆瓣的方式有点像机器人程序" in html and ("点击证明" in html or "tcaptcha_btn" in html):
            return True
        if "请依次点击" in html:
            return True
        return False
    except Exception:
        return False

async def _solve_tencent_click_captcha(page, *, budget_sec: float) -> bool:
    deadline = time.monotonic() + budget_sec
    root = _root_page(page)

    ctx = await _resolve_captcha_ctx(page, wait_sec=2.0)
    if ctx is None:
        logger.info("未检测到验证码面板，尝试点击「点击证明」")
        if not await _click_prove_button(page):
            return False
        remain = max(3.0, deadline - time.monotonic())
        ctx = await _resolve_captcha_ctx(page, wait_sec=min(remain, 14.0))
        if ctx is None:
            await _capture_and_save(root, "tencent_captcha_timeout")
            return False

    panel_bytes = await _capture_verification_panel(ctx)
    if not panel_bytes:
        await _capture_and_save(root, "no_captcha_panel")
        return False

    _save_page_snapshot(panel_bytes, "captcha_panel")

    norm_coords = await _call_qwen_for_captcha(panel_bytes)
    if not norm_coords or len(norm_coords) < 2:
        logger.warning("模型未返回有效坐标，可能识别失败")
        await _capture_and_save(root, "qwen_no_coords")
        return False

    try:
        await _click_on_slide_bg_by_norm(ctx, norm_coords, page)
    except Exception as e:
        logger.warning("点击过程异常: %s", e)
        await _capture_and_save(root, "click_failed")
        return False

    submitted = await _submit_tencent(ctx, page)
    if not submitted:
        logger.warning("未找到确定按钮，尝试刷新")
        try:
            refresh = ctx.locator(".tc-refresh, .tc-refresh-icon").first
            if await refresh.count() > 0:
                await refresh.click(timeout=2000, force=True)
                await asyncio.sleep(1.0)
        except Exception:
            pass

    await asyncio.sleep(1.5)
    ok = not await is_douban_captcha_page(page)
    logger.info("点选完成: submitted=%s access_ok=%s", submitted, ok)
    if not ok:
        await _capture_and_save(root, "captcha_final_failed")
    return ok

async def solve_douban_click_captcha(page, *, budget_sec: float = 18.0) -> bool:
    return await _solve_tencent_click_captcha(page, budget_sec=budget_sec)

async def ensure_douban_access(page, *, budget_sec: float = 28.0) -> tuple[bool, bool]:
    if not await is_douban_captcha_page(page):
        return True, False

    t0 = time.monotonic()
    if await solve_douban_click_captcha(page, budget_sec=max(16.0, budget_sec * 0.88)):
        if not await is_douban_captcha_page(page):
            return True, False

    remain = max(3.0, budget_sec - (time.monotonic() - t0))
    if remain > 2.0 and await solve_douban_click_captcha(page, budget_sec=remain):
        if not await is_douban_captcha_page(page):
            return True, False

    still = await is_douban_captcha_page(page)
    if still:
        await _capture_and_save(page, "final_access_blocked")
    return (not still), still

async def goto_douban_and_ensure(
    page,
    url: str,
    *,
    budget_sec: float = 28.0,
    wait_until: str = "domcontentloaded",
) -> tuple[bool, bool, Optional[str]]:
    from scrapers.playwright_common import apply_stealth
    await apply_stealth(page)
    
    start = time.monotonic()
    await page.goto(url, wait_until=wait_until, timeout=min(15000, int(budget_sec * 1000)))
    remain = max(6.0, budget_sec - (time.monotonic() - start))
    ok, exhausted = await ensure_douban_access(page, budget_sec=remain)
    html = await page.content() if ok else None
    return ok, exhausted, html
