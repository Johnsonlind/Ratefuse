# ==========================================
# 豆瓣图形点选验证码 - 火山方舟豆包多模态版
# ==========================================
from __future__ import annotations

import asyncio
import logging
import os
import time
import base64
import json
import re
from typing import Optional, Tuple, List

from playwright.async_api import Page

ARK_API_KEY = os.getenv("ARK_API_KEY") or os.getenv("DOUBAO_API_KEY", "")
if not ARK_API_KEY:
    raise RuntimeError(
        "未配置 ARK_API_KEY 或 DOUBAO_API_KEY。请使用火山方舟「API Key管理」生成的专属Key，"
        "不是 IAM 的 AK/SK。"
    )

ARK_BASE_URL = os.getenv(
    "ARK_BASE_URL",
    os.getenv("DOUBAO_API_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
).rstrip("/")
if ARK_BASE_URL.endswith("/chat/completions"):
    ARK_BASE_URL = ARK_BASE_URL[: -len("/chat/completions")].rstrip("/")

ARK_MODEL = os.getenv("ARK_MODEL") or os.getenv("DOUBAO_MODEL", "")
if not ARK_MODEL.startswith("ep-"):
    logging.warning(
        "ARK_MODEL 不是 ep- 开头的接入点ID（当前值：%s），"
        "请至火山方舟「模型推理」→「预置推理接入点」复制 ep- 开头的ID。",
        ARK_MODEL
    )

ARK_TIMEOUT = float(os.getenv("ARK_TIMEOUT", os.getenv("DOUBAO_TIMEOUT", "90")))

API_MAX_RETRY = 2
API_TIMEOUT = 15
API_RATE_LIMIT_BASE_WAIT = 2

logger = logging.getLogger(__name__)

def _png_dimensions(data: bytes) -> Tuple[int, int]:
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return (
            int.from_bytes(data[16:20], "big"),
            int.from_bytes(data[20:24], "big"),
        )
    return 0, 0

async def _capture_full_page(page) -> Optional[Tuple[bytes, int, int]]:
    """
    截取 viewport 全页（scale=css），与 page.mouse 坐标系一致。
    返回 (图片字节, 宽, 高)。不保存到磁盘。
    """
    root = _root_page(page)
    try:
        vp = root.viewport_size or {"width": 1280, "height": 720}
        img_bytes = await root.screenshot(type="png", scale="css")
        iw, ih = _png_dimensions(img_bytes)
        vw, vh = int(vp.get("width", 0)), int(vp.get("height", 0))
        if iw and vh and (abs(iw - vw) > 3 or abs(ih - vh) > 3):
            logger.warning(
                "截图尺寸 %dx%d 与 viewport %dx%d 不一致，点击时将按比例换算",
                iw,
                ih,
                vw,
                vh,
            )
        logger.info("全页截图: %dx%d (viewport %dx%d, scale=css)", iw or vw, ih or vh, vw, vh)
        return img_bytes, iw or vw, ih or vh
    except Exception as e:
        logger.debug("全页面截图失败: %s", e)
        return None

def _all_contexts(page) -> List:
    out = [page]
    try:
        out.extend(page.frames)
    except Exception:
        pass
    return out

def _root_page(ctx):
    return ctx if hasattr(ctx, "context") else getattr(ctx, "page", ctx)

def is_douban_captcha_html(html: str, url: str = "", title: str = "") -> bool:
    u = (url or "").lower()
    h = html or ""
    if "sec.douban.com" in u:
        return True
    if "turing.captcha.qcloud.com" in h or "tcaptcha" in h.lower():
        return True
    if "你访问豆瓣的方式有点像机器人程序" in h and ("点击证明" in h or "tcaptcha_btn" in h):
        return True
    if "请依次点击" in h:
        return True
    if "geetest" in h.lower() and ("captcha" in h.lower() or "点选" in h):
        return True
    t = (title or "").strip()
    if t in ("豆瓣", "豆瓣网", "验证码") and ("点击证明" in h or "安全验证" in h):
        return True
    return False

def is_douban_hard_block_html(html: str, url: str = "", page_title: str = "") -> bool:
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

async def _human_pause(min_ms: int = 120, max_ms: int = 380) -> None:
    await asyncio.sleep(((min_ms + max_ms) / 2) / 1000.0)

async def _slide_bg_box(ctx) -> Optional[dict]:
    try:
        slide = ctx.locator("#slideBg").first
        if await slide.count() == 0 or not await slide.is_visible():
            return None
        box = await slide.bounding_box()
        if box and box.get("width", 0) > 20 and box.get("height", 0) > 20:
            return box
    except Exception:
        pass
    return None

async def _capture_slide_reference(ctx) -> Optional[Tuple[bytes, int, int]]:
    """抓取 #slideBg 裁剪图（scale=css，与 bounding_box / mouse 同一坐标系）。不保存到磁盘。"""
    try:
        slide = ctx.locator("#slideBg").first
        if await slide.count() == 0 or not await slide.is_visible():
            return None
        try:
            img = await slide.screenshot(type="png", scale="css")
        except TypeError:
            img = await slide.screenshot(type="png")
        if img:
            iw, ih = _png_dimensions(img)
            logger.info("slideBg 裁剪图: %dx%d (scale=css)", iw, ih)
            return img, iw, ih
    except Exception:
        pass
    return None

async def _read_captcha_instruction(ctx) -> str:
    for sel in ("#instruction", ".tc-instruction", "#slideInstruction", ".tcaptcha-text"):
        try:
            loc = ctx.locator(sel).first
            if await loc.count() > 0:
                text = (await loc.inner_text()).strip()
                if text:
                    return text
        except Exception:
            continue
    return ""

async def _capture_instruction_reference(ctx) -> Optional[bytes]:
    """截取「请依次点击」提示条（含三个目标小图标），供模型对照形状。不保存到磁盘。"""
    selectors = (
        "#instruction",
        ".tc-instruction",
        "#slideInstruction",
        ".tcaptcha-instruction",
        "#bodyWrap .tc-instruction",
    )
    for sel in selectors:
        try:
            loc = ctx.locator(sel).first
            if await loc.count() == 0 or not await loc.is_visible():
                continue
            try:
                img = await loc.screenshot(type="png", scale="css")
            except TypeError:
                img = await loc.screenshot(type="png")
            if img:
                iw, ih = _png_dimensions(img)
                logger.info("instruction 提示条截图: %dx%d", iw, ih)
                return img
        except Exception:
            continue
    return None

def _coords_in_slide_image(
    coords: List[Tuple[int, int]],
    img_w: int,
    img_h: int,
    *,
    margin: int = 4,
) -> bool:
    """校验坐标落在 slideBg 裁剪图像素范围内（左上角 0,0）。"""
    if img_w <= 0 or img_h <= 0:
        return True
    x1, y1 = img_w - margin, img_h - margin
    for x, y in coords:
        if not (margin <= x <= x1 and margin <= y <= y1):
            logger.warning(
                "坐标 (%d,%d) 不在 slide 图 [%d,%d]-[%d,%d] 内",
                x,
                y,
                margin,
                margin,
                x1,
                y1,
            )
            return False
    return True

def _coords_in_slide_box_page(
    coords: List[Tuple[int, int]],
    slide_box: dict,
    *,
    margin: int = 4,
) -> bool:
    """校验整页坐标落在 #slideBg 的 page 坐标范围内。"""
    x0 = int(slide_box["x"]) + margin
    y0 = int(slide_box["y"]) + margin
    x1 = int(slide_box["x"] + slide_box["width"]) - margin
    y1 = int(slide_box["y"] + slide_box["height"]) - margin
    for x, y in coords:
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            logger.warning(
                "整页坐标 (%d,%d) 不在 #slideBg [%d,%d]-[%d,%d]",
                x,
                y,
                x0,
                y0,
                x1,
                y1,
            )
            return False
    return True

def _slide_local_to_page(
    lx: int,
    ly: int,
    slide_box: dict,
    *,
    img_w: int,
    img_h: int,
) -> Tuple[int, int]:
    """slide 裁剪图坐标 → 主页面 mouse 坐标（处理截图与 bbox 尺寸不一致）。"""
    bw = float(slide_box.get("width") or img_w or 1)
    bh = float(slide_box.get("height") or img_h or 1)
    sx = bw / img_w if img_w and abs(img_w - bw) > 1.5 else 1.0
    sy = bh / img_h if img_h and abs(img_h - bh) > 1.5 else 1.0
    if sx != 1.0 or sy != 1.0:
        logger.info(
            "slide 坐标缩放 img %dx%d -> bbox %.0fx%.0f (sx=%.3f sy=%.3f)",
            img_w,
            img_h,
            bw,
            bh,
            sx,
            sy,
        )
    px = int(slide_box["x"]) + int(round(lx * sx))
    py = int(slide_box["y"]) + int(round(ly * sy))
    x0, y0 = int(slide_box["x"]), int(slide_box["y"])
    px = max(x0 + 3, min(px, x0 + int(bw) - 3))
    py = max(y0 + 3, min(py, y0 + int(bh) - 3))
    return px, py

async def _click_mark_count(ctx) -> int:
    try:
        return await ctx.locator(".tc-click-mark").count()
    except Exception:
        return 0

async def _click_prove_button(page) -> bool:
    selectors = (
        "#tcaptcha_btn",
        'button:has-text("点击证明")',
        'a:has-text("点击证明")',
    )
    root = _root_page(page)
    for sel in selectors:
        try:
            loc = root.locator(sel).first
            if await loc.count() == 0:
                continue
            await loc.scroll_into_view_if_needed(timeout=2000)
            await loc.click(timeout=4000, force=True)
            await _human_pause(400, 700)
            logger.info("已点击「点击证明」: %s", sel)
            return True
        except Exception as e:
            logger.debug("点击证明(%s)失败: %s", sel, e)
    return False

def _parse_doubao_coord_response(resp_text: str) -> Optional[List[List[int]]]:
    """从豆包返回文本中解析 [[x,y],...] 坐标数组。"""
    resp_text = (resp_text or "").replace("```json", "").replace("```", "").strip()
    json_candidate = None
    start = resp_text.find("[")
    end = resp_text.rfind("]")
    if start >= 0 and end > start:
        json_candidate = resp_text[start : end + 1]

    if json_candidate:
        try:
            data = json.loads(json_candidate)
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass

    pairs = re.findall(r"\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]", resp_text)
    if pairs and len(pairs) >= 2:
        return [[int(x), int(y)] for x, y in pairs]
    return None

def _call_doubao_ark_sync(
    messages: list,
    *,
    attempt: int,
) -> Optional[str]:
    """同步调用火山方舟 Ark chat.completions，返回模型文本。"""
    from volcenginesdkarkruntime import Ark

    if not ARK_API_KEY:
        raise RuntimeError("未配置 ARK_API_KEY 或 DOUBAO_API_KEY，无法调用豆包多模态")

    client = Ark(base_url=ARK_BASE_URL, api_key=ARK_API_KEY)
    response = client.chat.completions.create(
        model=ARK_MODEL,
        messages=messages,
        temperature=0,
        timeout=ARK_TIMEOUT,
        extra_headers={"x-is-encrypted": "true"},
    )
    choice = response.choices[0] if response.choices else None
    if not choice or not choice.message:
        logger.warning("第%s次请求：豆包返回无 choices", attempt)
        return None
    content = choice.message.content
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
            elif hasattr(block, "text"):
                parts.append(str(block.text))
        return "\n".join(parts).strip()
    return str(content).strip() if content is not None else None

async def _call_doubao_for_captcha(
    *,
    slide_ref_bytes: bytes,
    slide_img_w: int,
    slide_img_h: int,
    instruction: str = "",
    instruction_ref_bytes: Optional[bytes] = None,
) -> Optional[List[Tuple[int, int]]]:
    """
    调用豆包识别 #slideBg 裁剪图坐标（局部坐标系，精度高于整页图）。
    返回 (x,y) 相对 slide 图左上角，宽 slide_img_w、高 slide_img_h。
    """
    if not slide_ref_bytes:
        return None
    iw = slide_img_w or _png_dimensions(slide_ref_bytes)[0]
    ih = slide_img_h or _png_dimensions(slide_ref_bytes)[1]
    slide_uri = (
        f"data:image/png;base64,{base64.b64encode(slide_ref_bytes).decode('utf-8')}"
    )
    instr_hint = f"\n补充文字：{instruction}\n" if instruction else ""

    content_items: list = []
    if instruction_ref_bytes:
        target_uri = (
            f"data:image/png;base64,"
            f"{base64.b64encode(instruction_ref_bytes).decode('utf-8')}"
        )
        content_items.append({"type": "image_url", "image_url": {"url": target_uri}})
        img_desc = """
图1：「请依次点击」提示条，灰框内从左到右是第1、第2、第3个目标（形状/数字）。
图2：可点击大图（仅云朵背景+黑色图标，不含顶部灰条）。"""
    else:
        img_desc = "\n附图是可点击大图。"

    prompt_text = f"""你是点选验证码识别工具。{img_desc}{instr_hint}

在图2 中按图1 顺序（第1个目标→第2个→第3个）找相同黑色图标/数字的几何中心。

规则：
- 坐标系：图2 左上角 (0,0)，宽 {iw} 高 {ih}；
- 顺序=图1 目标顺序，禁止按图2 从左到右；
- 每种目标在图2 只出现一次，必须匹配形状（如「8」与「0」不可混淆）；
- 忽略蓝色序号圆点；
- 只输出 3 个点的 JSON：[[x1,y1],[x2,y2],[x3,y3]]。"""

    content_items.append({"type": "image_url", "image_url": {"url": slide_uri}})
    content_items.append({"type": "text", "text": prompt_text.strip()})
    messages = [{"role": "user", "content": content_items}]

    for attempt in range(1, API_MAX_RETRY + 1):
        try:
            resp_text = await asyncio.to_thread(
                _call_doubao_ark_sync, messages, attempt=attempt
            )
            if not resp_text:
                await asyncio.sleep(1.0)
                continue

            data = _parse_doubao_coord_response(resp_text)
            if not data:
                logger.warning(
                    "第%s次请求：无法解析坐标 JSON: %s",
                    attempt,
                    resp_text[:200],
                )
                await asyncio.sleep(1.0)
                continue

            if len(data) < 3:
                logger.warning("第%s次请求：坐标数量不足(需3个)，重试", attempt)
                await asyncio.sleep(1.0)
                continue

            point_list: List[Tuple[int, int]] = []
            for item in data:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    point_list.append((max(0, int(item[0])), max(0, int(item[1]))))
            point_list = point_list[:3]

            if len(point_list) < 3:
                logger.warning("第%s次请求：有效坐标不足 3 个，重试", attempt)
                await asyncio.sleep(1.0)
                continue

            if not _coords_in_slide_image(point_list, iw, ih):
                logger.warning("第%s次请求：坐标超出 slide 图范围，重试", attempt)
                await asyncio.sleep(1.0)
                continue

            logger.info("豆包返回 slide 坐标: %s (图 %dx%d)", point_list, iw, ih)
            return point_list

        except Exception as e:
            error_msg = str(e).lower()
            if "rate limit" in error_msg or "too many requests" in error_msg:
                wait = API_RATE_LIMIT_BASE_WAIT ** attempt + 1.0
                logger.warning(
                    "第%s次请求触发限流，等待 %.1f 秒后重试 (错误: %s)",
                    attempt, wait, e
                )
                await asyncio.sleep(wait)
            else:
                logger.exception("第%s次请求：豆包 Ark 调用异常 %s", attempt, e)
                await asyncio.sleep(2.0)
            continue

    logger.error("豆包所有重试次数用尽，识别失败")
    return None

async def _refresh_captcha(ctx) -> bool:
    """刷新验证码并等待旧蓝点清除。"""
    for sel in (".tc-refresh", ".tc-refresh-icon", "#reload"):
        try:
            loc = ctx.locator(sel).first
            if await loc.count() > 0:
                await loc.click(force=True, timeout=3000)
                break
        except Exception:
            continue
    await asyncio.sleep(1.0)
    for _ in range(25):
        if await _click_mark_count(ctx) == 0:
            logger.info("验证码已刷新，标记已清零")
            return True
        await asyncio.sleep(0.12)
    logger.warning("刷新后仍有 %s 个旧标记", await _click_mark_count(ctx))
    return False

async def _log_verify_btn_state(ctx) -> None:
    try:
        state = await ctx.evaluate("""
        () => {
          const b = document.querySelector('.verify-btn, #verifyBtn');
          if (!b) return { found: false };
          const s = getComputedStyle(b);
          return {
            found: true,
            className: b.className,
            text: (b.textContent || '').trim(),
            hasShow: b.classList.contains('show'),
            disabled: b.classList.contains('disable') || b.classList.contains('disabled'),
            opacity: s.opacity,
            pointerEvents: s.pointerEvents,
          };
        }
        """)
        logger.info("确定按钮状态: %s", state)
    except Exception as e:
        logger.debug("读取确定按钮状态失败: %s", e)

async def _click_slide_coords(
    page,
    coords: List[Tuple[int, int]],
    *,
    ctx,
    slide_img_w: int,
    slide_img_h: int,
) -> int:
    """slide 局部坐标 → #slideBg 内 element.click（iframe 内更可靠）。"""
    slide = ctx.locator("#slideBg").first
    await slide.scroll_into_view_if_needed(timeout=2000)

    for idx, (lx, ly) in enumerate(coords):
        sbox = await _slide_bg_box(ctx)
        if not sbox:
            logger.warning("第 %d 个点：无 #slideBg bbox", idx + 1)
            continue
        px, py = _slide_local_to_page(
            lx, ly, sbox, img_w=slide_img_w, img_h=slide_img_h
        )
        rel_x = int(px - sbox["x"])
        rel_y = int(py - sbox["y"])
        before = await _click_mark_count(ctx)
        logger.info(
            "第 %d 点: slide(%d,%d) rel(%d,%d) page(%d,%d) 标记=%s",
            idx + 1,
            lx,
            ly,
            rel_x,
            rel_y,
            px,
            py,
            before,
        )
        try:
            await slide.click(position={"x": rel_x, "y": rel_y}, timeout=5000)
            for _ in range(15):
                await asyncio.sleep(0.1)
                after = await _click_mark_count(ctx)
                if after > before:
                    logger.info("slide 点击后标记 %s->%s", before, after)
                    break
            else:
                logger.warning("第 %d 点 slide 点击未增标记，尝试 page.mouse", idx + 1)
                root = _root_page(page)
                await root.mouse.click(px, py)
                await asyncio.sleep(0.35)
        except Exception as e:
            logger.warning("第 %d 点点击异常: %s", idx + 1, e)

    return await _click_mark_count(ctx)

async def _is_verify_btn_ready(ctx) -> bool:
    """用 DOM class 判断（比 locator.is_visible 可靠，iframe 内按钮常被误判不可见）。"""
    try:
        return bool(
            await ctx.evaluate(
                """
            () => {
              const b = document.querySelector('.verify-btn, #verifyBtn');
              if (!b) return false;
              if (b.classList.contains('disable') || b.classList.contains('disabled')) {
                return false;
              }
              return b.classList.contains('show')
                || b.classList.contains('tc-verify-btn-show');
            }
            """
            )
        )
    except Exception:
        return False

async def _wait_verify_btn_ready(ctx, timeout: float = 8.0) -> bool:
    """等待「确定」按钮出现 .show（点选全部正确时腾讯才会加上）。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if await _is_verify_btn_ready(ctx):
            return True
        await asyncio.sleep(0.15)
    return False

async def _submit_tencent(ctx, page) -> bool:
    root = _root_page(page)
    targets = [ctx, root, *_all_contexts(root)]

    if not await _wait_verify_btn_ready(ctx, timeout=5.0):
        await _log_verify_btn_state(ctx)
        logger.warning("确定按钮未就绪(.show)，跳过提交")
        return False

    await asyncio.sleep(0.25)

    for target in targets:
        try:
            clicked = await target.evaluate(
                """
            () => {
              const btn = document.querySelector(
                '.verify-btn.show, .verify-btn.tc-verify-btn-show, #verifyBtn.show'
              );
              if (!btn) return false;
              btn.click();
              return true;
            }
            """
            )
            if clicked:
                logger.info("已点击确定（JS .verify-btn.show）")
                await asyncio.sleep(2.0)
                return True
        except Exception:
            continue

    selectors = (
        ".verify-btn.show",
        "#bodyWrap .verify-btn.show",
        ".tcaptcha-embed .verify-btn.show",
    )
    for target in targets:
        for sel in selectors:
            try:
                loc = target.locator(sel).first
                if await loc.count() == 0:
                    continue
                await loc.click(timeout=5000, force=True)
                logger.info("已点击确定按钮: %s", sel)
                await asyncio.sleep(2.0)
                return True
            except Exception as e:
                logger.debug("提交按钮点击失败(%s): %s", sel, e)
    return False

async def _wait_captcha_resolved(page, timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not await is_douban_captcha_page(page):
            return True
        await asyncio.sleep(0.35)
    return False

async def _resolve_captcha_ctx(page, wait_sec=12.0):
    deadline = time.monotonic() + wait_sec
    while time.monotonic() < deadline:
        for ctx in _all_contexts(page):
            try:
                loc = ctx.locator("#slideBg").first
                if await loc.count() > 0 and await loc.is_visible():
                    logger.info("找到验证码 iframe/上下文")
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
    # 单轮尝试，不再循环重试
    root = _root_page(page)

    ctx = await _resolve_captcha_ctx(page, wait_sec=2.0)
    if ctx is None:
        logger.info("未检测到验证码面板，尝试点击「点击证明」")
        if not await _click_prove_button(page):
            return False
        remain = max(3.0, budget_sec - 2.0)
        ctx = await _resolve_captcha_ctx(page, wait_sec=min(remain, 14.0))
        if ctx is None:
            return False

    slide_box = await _slide_bg_box(ctx)
    if not slide_box:
        logger.warning("未获取 #slideBg 区域，无法点选")
        return False
    logger.info(
        "#slideBg 区域: x=%.0f y=%.0f w=%.0f h=%.0f",
        slide_box["x"],
        slide_box["y"],
        slide_box["width"],
        slide_box["height"],
    )

    slide_img_w, slide_img_h = 0, 0

    instruction = await _read_captcha_instruction(ctx)
    instruction_ref = await _capture_instruction_reference(ctx)
    slide_capture = await _capture_slide_reference(ctx)
    if not slide_capture:
        logger.warning("未获取到 slideBg 截图")
        return False
    slide_bytes, siw, sih = slide_capture
    slide_img_w, slide_img_h = siw, sih
    slide_box = await _slide_bg_box(ctx) or slide_box

    click_coords = await _call_doubao_for_captcha(
        slide_ref_bytes=slide_bytes,
        slide_img_w=siw,
        slide_img_h=sih,
        instruction=instruction,
        instruction_ref_bytes=instruction_ref,
    )
    if not click_coords:
        logger.warning("识别坐标失败")
        return False

    marks = await _click_slide_coords(
        page,
        click_coords,
        ctx=ctx,
        slide_img_w=slide_img_w,
        slide_img_h=slide_img_h,
    )

    if marks < 3:
        logger.warning("标记不足 %s/3", marks)
        return False

    ready = await _is_verify_btn_ready(ctx)
    if not ready:
        await asyncio.sleep(0.5)
        ready = await _wait_verify_btn_ready(ctx, timeout=8.0)
    if not ready:
        await _log_verify_btn_state(ctx)
        logger.warning("已有 %s 个标记但确定无 .show（点错目标）", marks)
        return False

    logger.info("确定按钮已就绪，开始提交")
    submitted = await _submit_tencent(ctx, page)
    if not submitted:
        logger.warning("确定按钮点击失败")
        return False

    ok = await _wait_captcha_resolved(page, timeout=12.0)
    logger.info("验证码完成: 提交=%s 验证通过=%s", submitted, ok)
    return ok

async def solve_douban_click_captcha(page, *, budget_sec: float = 18.0) -> bool:
    return await _solve_tencent_click_captcha(page, budget_sec=budget_sec)

async def ensure_douban_access(page, *, budget_sec: float = 28.0) -> Tuple[bool, bool]:
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
    return (not still), still

async def goto_douban_and_ensure(
    page,
    url: str,
    *,
    budget_sec: float = 28.0,
    wait_until: str = "domcontentloaded",
) -> Tuple[bool, bool, Optional[str]]:
    from scrapers.playwright_common import apply_stealth
    await apply_stealth(page)

    start = time.monotonic()
    await page.goto(url, wait_until=wait_until, timeout=min(15000, int(budget_sec * 1000)))
    remain = max(6.0, budget_sec - (time.monotonic() - start))
    ok, exhausted = await ensure_douban_access(page, budget_sec=remain)
    html = await page.content() if ok else None
    return ok, exhausted, html
