# ==========================================
# 评分抓取与聚合核心模块
# ==========================================
import os
import re
import json
import hashlib
import random
import asyncio
import traceback
from fuzzywuzzy import fuzz
import copy
import aiohttp
from urllib.parse import quote
from dataclasses import dataclass
from fastapi import Request
import unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional
import time
from sqlalchemy.orm import Session
from sqlalchemy import func
from models import MediaPlatformStatus, MediaPlatformStatusLog, _shanghai_naive_now
from browser_pool import (
    browser_pool,
    douban_playwright_session_semaphore,
    wait_before_douban_playwright_async,
)
from anthology_handler import anthology_handler

class LogFormatter:
    """结构化日志输出"""
    COLORS = {
        'RESET': '\033[0m',
        'BOLD': '\033[1m',
        'GREEN': '\033[92m',
        'YELLOW': '\033[93m',
        'RED': '\033[91m',
        'BLUE': '\033[94m',
        'CYAN': '\033[96m',
    }
    
    @staticmethod
    def platform(platform_name: str) -> str:
        """平台名称"""
        return f"{LogFormatter.COLORS['CYAN']}[{platform_name}]{LogFormatter.COLORS['RESET']}"
    
    @staticmethod
    def success(msg: str) -> str:
        """成功信息"""
        return f"{LogFormatter.COLORS['GREEN']}✓ {msg}{LogFormatter.COLORS['RESET']}"
    
    @staticmethod
    def error(msg: str) -> str:
        """错误信息"""
        return f"{LogFormatter.COLORS['RED']}✗ {msg}{LogFormatter.COLORS['RESET']}"
    
    @staticmethod
    def warning(msg: str) -> str:
        """警告信息"""
        return f"{LogFormatter.COLORS['YELLOW']}⚠ {msg}{LogFormatter.COLORS['RESET']}"
    
    @staticmethod
    def info(msg: str) -> str:
        """一般信息"""
        return f"{LogFormatter.COLORS['BLUE']}→ {msg}{LogFormatter.COLORS['RESET']}"
    
    @staticmethod
    def section(title: str) -> str:
        """章节标题"""
        line = "=" * 60
        return f"\n{LogFormatter.COLORS['BOLD']}{line}\n  {title}\n{line}{LogFormatter.COLORS['RESET']}"
    
    @staticmethod
    def performance(platform: str, elapsed: float, status: str = "success") -> str:
        """性能指标"""
        status_icon = "✓" if status == "success" else "✗"
        color = LogFormatter.COLORS['GREEN'] if status == "success" else LogFormatter.COLORS['RED']
        return f"{color}{status_icon} {platform}: {elapsed:.2f}秒{LogFormatter.COLORS['RESET']}"

log = LogFormatter()

TMDB_API_BASE_URL = os.getenv("TMDB_API_BASE_URL", "")
if not TMDB_API_BASE_URL.endswith("/"):
    TMDB_API_BASE_URL = f"{TMDB_API_BASE_URL}/"
TMDB_BEARER_TOKEN = os.getenv("TMDB_TOKEN", "")

import httpx
_tmdb_http_client = None

def get_tmdb_http_client():
    """获取或创建 TMDB API 客户端"""
    global _tmdb_http_client
    if _tmdb_http_client is None or _tmdb_http_client.is_closed:
        _tmdb_http_client = httpx.AsyncClient(
            http2=True,
            timeout=httpx.Timeout(10.0),
            limits=httpx.Limits(
                max_connections=100,
                max_keepalive_connections=20,
                keepalive_expiry=30.0
            ),
            headers={
                "accept": "application/json",
                "accept-encoding": "gzip, deflate",
                "Authorization": f"Bearer {TMDB_BEARER_TOKEN}"
            }
        )
    return _tmdb_http_client

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/89.0.2 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/89.0.2 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/91.0.864.67 Safari/537.36"
]

RATING_STATUS = {
    "NO_FOUND": "No Found",
    "FETCH_FAILED": "Fail",
    "NO_RATING": "No Rating",
    "RATE_LIMIT": "RateLimit",
    "TIMEOUT": "Timeout",
    "SUCCESSFUL": "Successful",
    "LOCKED": "Locked",
}

AUTO_LOCK_THRESHOLD = 5

def get_media_platform_status(
    db: Session,
    media_type: str,
    tmdb_id: int,
    platform: str,
) -> Optional[MediaPlatformStatus]:
    media_type = (media_type or "").lower()
    platform = (platform or "").lower()
    return (
        db.query(MediaPlatformStatus)
        .filter(
            func.lower(MediaPlatformStatus.media_type) == media_type,
            MediaPlatformStatus.tmdb_id == tmdb_id,
            func.lower(MediaPlatformStatus.platform) == platform,
        )
        .one_or_none()
    )

def is_platform_locked(
    db: Session,
    media_type: str,
    tmdb_id: int,
    platform: str,
) -> bool:
    status = get_media_platform_status(db, media_type, tmdb_id, platform)
    return bool(status and status.status == "locked")

def update_platform_status_after_fetch(
    db: Session,
    media_type: str,
    tmdb_id: int,
    platform: str,
    title: Optional[str],
    status: str,
    status_reason: Optional[str],
) -> None:
    media_type = (media_type or "").lower()
    platform = (platform or "").lower()
    record = get_media_platform_status(db, media_type, tmdb_id, platform)

    if record is None:
        record = MediaPlatformStatus(
            media_type=media_type,
            tmdb_id=tmdb_id,
            platform=platform,
            status="active",
            failure_count=0,
            title_snapshot=title,
        )
        db.add(record)
        try:
            db.flush()
        except Exception:
            db.rollback()
            record = get_media_platform_status(db, media_type, tmdb_id, platform)
            if record is None:
                raise

    if status == RATING_STATUS["SUCCESSFUL"]:
        if record.failure_count or record.status == "locked":
            from_status = record.status
            record.failure_count = 0
            record.last_failure_status = None
            record.last_status_changed_at = _shanghai_naive_now()
            db.add(
                MediaPlatformStatusLog(
                    media_type=media_type,
                    tmdb_id=tmdb_id,
                    platform=platform,
                    from_status=from_status,
                    to_status=record.status,
                    change_type="auto_update",
                    reason="抓取成功，重置失败计数",
                )
            )
        return

    if status not in (
        RATING_STATUS["NO_FOUND"],
        RATING_STATUS["FETCH_FAILED"],
        RATING_STATUS["TIMEOUT"],
        RATING_STATUS["RATE_LIMIT"],
    ):
        return

    record.failure_count = (record.failure_count or 0) + 1
    record.last_failure_status = status
    record.last_status_changed_at = _shanghai_naive_now()

    db.add(
        MediaPlatformStatusLog(
            media_type=media_type,
            tmdb_id=tmdb_id,
            platform=platform,
            from_status=record.status,
            to_status=record.status,
            change_type="auto_update",
            reason=f"抓取失败一次：{status} - {status_reason or ''}",
        )
    )

    if record.failure_count >= AUTO_LOCK_THRESHOLD and record.status != "locked":
        from_status = record.status
        record.status = "locked"
        record.lock_source = "auto"
        auto_remark = f"自动锁定：连续{AUTO_LOCK_THRESHOLD}次抓取失败（最后一次状态：{status} - {status_reason or ''}）"
        record.remark = (record.remark + " | " if record.remark else "") + auto_remark
        record.last_status_changed_at = _shanghai_naive_now()

        db.add(
            MediaPlatformStatusLog(
                media_type=media_type,
                tmdb_id=tmdb_id,
                platform=platform,
                from_status=from_status,
                to_status="locked",
                change_type="auto_lock",
                reason=auto_remark,
            )
        )

def create_rating_data(status, reason=None):
    """创建统一的评分数据结构"""
    base_data = {
        "status": status,
        "status_reason": reason,
        "rating": "暂无" if status != RATING_STATUS["SUCCESSFUL"] else None,
        "rating_people": "暂无" if status != RATING_STATUS["SUCCESSFUL"] else None
    }
    return base_data

class RequestCancelledException(Exception):
    pass

async def random_delay():
    delay = random.uniform(0.2, 0.5)
    await asyncio.sleep(delay)

MAX_MATCH_CANDIDATES_PER_PLATFORM = 5

_LETTERBOXD_FLARESOVERR_CACHE_TTL_SEC = int(os.environ.get("LETTERBOXD_FLARESOVERR_CACHE_TTL_SEC", "600"))
_letterboxd_flaresolverr_cache: dict = {
    "expires_at": 0.0,
    "cookies": None,
    "userAgent": None,
}
_letterboxd_flaresolverr_cache_lock = asyncio.Lock()

def _douban_human_seconds(phase: str) -> float:
    """用偏长尾的间隔模拟非匀速阅读/找链接"""
    if phase == "before_search_nav":
        base = random.gammavariate(2.2, 0.95)
        if random.random() < 0.11:
            base += random.uniform(2.5, 12.0)
        return float(min(max(base, 1.0), 24.0))
    if phase == "after_search_dom":
        base = random.gammavariate(1.6, 0.55) + random.uniform(0.25, 0.9)
        return float(min(max(base, 0.35), 8.0))
    if phase == "before_parse_search":
        return float(random.uniform(0.15, 0.65))
    if phase == "after_detail_dom":
        base = random.gammavariate(1.8, 0.7) + random.uniform(0.35, 1.2)
        if random.random() < 0.07:
            base += random.uniform(1.5, 5.5)
        return float(min(max(base, 0.5), 14.0))
    if phase == "before_rating_parse":
        return float(random.gammavariate(1.3, 0.45) + random.uniform(0.2, 0.8))
    return float(random.uniform(0.5, 1.5))

async def douban_human_wait(phase: str) -> None:
    await asyncio.sleep(_douban_human_seconds(phase))

async def douban_simulate_light_browsing(page) -> None:
    """轻量鼠标轨迹与滚动，模拟扫一眼列表/详情"""
    try:
        vp = page.viewport_size
        if not vp:
            w, h = 1280, 720
        else:
            w, h = int(vp.get("width", 1280)), int(vp.get("height", 720))
        w, h = max(w, 220), max(h, 220)
        for _ in range(random.randint(1, 4)):
            x = random.randint(40, w - 20)
            y = random.randint(50, h - 20)
            await page.mouse.move(x, y, steps=random.randint(10, 28))
            await asyncio.sleep(random.uniform(0.04, 0.22))
        scroll_px = random.randint(80, min(520, h + 220))
        await page.mouse.wheel(0, scroll_px)
        await asyncio.sleep(random.uniform(0.18, 0.75))
        if random.random() < 0.35:
            await page.mouse.wheel(0, random.randint(-100, -25))
            await asyncio.sleep(random.uniform(0.1, 0.4))
    except Exception:
        pass

def chinese_to_arabic(chinese_num):
    """将中文数字转换为阿拉伯数字"""
    chinese_to_arabic_map = {
        '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, 
        '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, 
        '十': 10, '百': 100
    }
    
    if not chinese_num:
        return None
        
    if chinese_num.startswith('十') and len(chinese_num) == 2:
        return 10 + chinese_to_arabic_map.get(chinese_num[1], 0)
    
    if chinese_num == '十':
        return 10
        
    result = 0
    unit = 1
    last_num = 0
    
    for char in reversed(chinese_num):
        if char in ['十', '百']:
            unit = chinese_to_arabic_map[char]
            if last_num == 0:
                last_num = 1
            result += last_num * unit
            last_num = 0
            unit = 1
        elif char in chinese_to_arabic_map:
            last_num = chinese_to_arabic_map[char]
            result += last_num * unit
        else:
            return None
            
    return result

def construct_search_url(title, media_type, platform, tmdb_info):
    """根据影视类型构造各平台搜索URL"""
    encoded_title = quote(title)
    if platform in ("metacritic", "rottentomatoes"):
        search_title = tmdb_info.get("en_title") or title
        simplified_title = ''.join(
            c for c in unicodedata.normalize('NFD', search_title)
            if unicodedata.category(c) != 'Mn'
        )
        encoded_title = quote(simplified_title)

    tmdb_id = tmdb_info.get("tmdb_id")
    year = tmdb_info.get("year")
    imdb_id = tmdb_info.get("imdb_id")

    search_urls = {
        "douban": {
            "movie": f"https://search.douban.com/movie/subject_search?search_text={encoded_title}",
            "tv": f"https://search.douban.com/movie/subject_search?search_text={encoded_title}"
        },
        "imdb": {
            "movie": f"https://www.imdb.com/find/?q={encoded_title}&s=tt&ttype=ft&ref_=fn_mv",
            "tv": f"https://www.imdb.com/find/?q={encoded_title}&s=tt&ttype=tv&ref_=fn_tv"
        },
        "letterboxd": {
            "movie": _get_letterboxd_search_urls(tmdb_id, year, imdb_id),
            "tv": _get_letterboxd_search_urls(tmdb_id, year, imdb_id)
        },
        "rottentomatoes": {
            "movie": f"https://www.rottentomatoes.com/search?search={encoded_title}",
            "tv": f"https://www.rottentomatoes.com/search?search={encoded_title}"
        },
        "metacritic": {
            "movie": f"https://www.metacritic.com/search/{encoded_title}/?page=1&category=2",
            "tv": f"https://www.metacritic.com/search/{encoded_title}/?page=1&category=1"
        }
    }
    result = search_urls[platform][media_type] if platform in search_urls and media_type in search_urls[platform] else ""
    return result

def _get_letterboxd_search_urls(tmdb_id, year, imdb_id):
    """为Letterboxd生成多种搜索URL"""
    urls = []
    if tmdb_id and year:
        urls.append(f"https://letterboxd.com/search/tmdb:{tmdb_id} year:{year}/")
    if imdb_id:
        urls.append(f"https://letterboxd.com/search/imdb:{imdb_id}/")
    if tmdb_id:
        urls.append(f"https://letterboxd.com/search/tmdb:{tmdb_id}/")
    return urls if urls else [""]
        
def _is_empty(value):
    """检查值是否为空"""
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, list):
        return len(value) == 0
    return False

def _get_field_value(data_list, field_path, check_empty=_is_empty):
    """从多语言数据列表中按优先级获取字段值"""
    for data, lang in data_list:
        value = data
        for key in field_path.split('.'):
            if isinstance(value, dict):
                value = value.get(key)
            else:
                value = None
                break
        
        if not check_empty(value):
            return value
    return None

def _merge_multi_language_data(data_list):
    """合并多语言数据"""
    if not data_list:
        return None
    
    base_data, _ = data_list[0]
    merged = copy.deepcopy(base_data)
    
    key_fields = [
        'title',
        'name',
        'original_title',
        'original_name',
        'overview',
        'tagline',
    ]
    
    for field in key_fields:
        if _is_empty(merged.get(field)):
            value = _get_field_value(data_list, field)
            if value is not None:
                merged[field] = value
    
    if _is_empty(merged.get('genres')):
        genres = _get_field_value(data_list, 'genres', lambda x: not isinstance(x, list) or len(x) == 0)
        if genres:
            merged['genres'] = genres
    
    if 'seasons' in merged and isinstance(merged['seasons'], list):
        for i, season in enumerate(merged['seasons']):
            if _is_empty(season.get('name')):
                for data, _ in data_list:
                    if data.get('seasons') and i < len(data['seasons']):
                        season_name = data['seasons'][i].get('name')
                        if not _is_empty(season_name):
                            merged['seasons'][i]['name'] = season_name
                            break
            
            if _is_empty(season.get('overview')):
                for data, _ in data_list:
                    if data.get('seasons') and i < len(data['seasons']):
                        season_overview = data['seasons'][i].get('overview')
                        if not _is_empty(season_overview):
                            merged['seasons'][i]['overview'] = season_overview
                            break
    
    return merged

async def _fetch_tmdb_with_language_fallback(client, endpoint, append_to_response=None):
    """按优先级顺序获取TMDB数据"""
    language_priority = ['zh-CN', 'zh-SG', 'zh-TW', 'zh-HK', 'en-US']
    
    async def fetch_language(lang):
        try:
            params = {"language": lang}
            if append_to_response:
                params["append_to_response"] = append_to_response
            
            response = await client.get(endpoint, params=params)
            
            if response.status_code != 200:
                return (lang, None, f"HTTP {response.status_code}")
            
            data = response.json()
            
            if data.get("status_code") and data.get("status_code") != 1:
                return (lang, None, data.get("status_message", "Unknown error"))
            
            return (lang, data, None)
        except Exception as e:
            return (lang, None, str(e))
    
    results = await asyncio.gather(*[fetch_language(lang) for lang in language_priority], return_exceptions=True)
    
    data_list = []
    errors = []
    
    for result in results:
        if isinstance(result, Exception):
            continue
        
        lang, data, error = result
        if data:
            data_list.append((data, lang))
        else:
            errors.append((lang, error))
    
    if not data_list:
        raise Exception(f"所有语言版本获取失败: {', '.join([f'{lang}: {error}' for lang, error in errors])}")
    
    return _merge_multi_language_data(data_list)

async def get_tmdb_info(tmdb_id, media_type, request=None):
    """通过TMDB API获取影视基本信息"""
    try:
        if request and await request.is_disconnected():
            return None
        
        client = get_tmdb_http_client()
        endpoint = f"{TMDB_API_BASE_URL}{media_type}/{tmdb_id}"
        
        try:
            merged_data = await _fetch_tmdb_with_language_fallback(
                client, 
                endpoint, 
                append_to_response="credits,external_ids"
            )
        except httpx.TimeoutException:
            print("TMDB API 请求超时")
            return None
        except Exception as e:
            print(f"TMDB API 请求失败: {e}")
            return None

        if not merged_data:
            if not request or not (await request.is_disconnected()):
                print("API返回的数据为空")
            return None
            
        if request and await request.is_disconnected():
            return None
        
        en_title = ""
        try:
            en_params = {"language": "en-US"}
            if "credits" in merged_data or "external_ids" in merged_data:
                en_params["append_to_response"] = "credits,external_ids"
            en_response = await client.get(endpoint, params=en_params)
            if en_response.status_code == 200:
                en_data = en_response.json()
                if media_type == "movie":
                    en_title = en_data.get("title", "")
                else:
                    en_title = en_data.get("name", "")
        except Exception as e:
            print(f"获取英文标题失败: {e}")
        
        if media_type == "movie":
            title = merged_data.get("title", "")
            original_title = merged_data.get("original_title", "")
            zh_title = merged_data.get("title", "")
            year = merged_data.get("release_date", "")[:4] if merged_data.get("release_date") else ""
        else:
            title = merged_data.get("name", "")
            original_title = merged_data.get("original_name", "")
            zh_title = merged_data.get("name", "")
            year = merged_data.get("first_air_date", "")[:4] if merged_data.get("first_air_date") else ""
        
        director = ""
        if "credits" in merged_data and merged_data["credits"]:
            crew = merged_data["credits"].get("crew", [])
            directors = [c["name"] for c in crew if c.get("job") == "Director"]
            director = ", ".join(directors)
        
        result = {
            "type": media_type,
            "title": title,
            "original_title": original_title,
            "en_title": en_title,
            "zh_title": zh_title,
            "year": year,
            "director": director,
            "tmdb_id": str(tmdb_id),
            "imdb_id": merged_data.get("imdb_id") or merged_data.get("external_ids", {}).get("imdb_id", "")
        }
        
        if media_type == "tv":
            result.update({
                "first_air_date": merged_data.get("first_air_date", ""),
                "number_of_seasons": merged_data.get("number_of_seasons", 0),
                "last_air_date": merged_data.get("last_air_date", ""),
                "seasons": [{
                    "season_number": s.get("season_number"),
                    "name": s.get("name", f"Season {s.get('season_number')}"),
                    "air_date": s.get("air_date", "")[:4] if s.get("air_date") else "",
                    "episode_count": s.get("episode_count", 0)
                } for s in merged_data.get("seasons", [])]
            })
            
            is_anthology = anthology_handler.is_anthology_series(result)
            result["is_anthology"] = is_anthology
            
            if is_anthology:
                print(f"\n=== 检测到可能的选集剧: {title} ===")
                
                series_info = anthology_handler.extract_main_series_info(result)
                
                tmdb_id = result.get("tmdb_id")
                if tmdb_id:
                    print("尝试从第一集获取主系列信息...")
                    main_series_info = await anthology_handler.get_main_series_info_from_first_episode(
                        tmdb_id, 
                        season_number=1, 
                        episode_number=1
                    )
                    
                    if main_series_info:
                        if not series_info:
                            series_info = {}
                        
                        main_series_imdb_id = main_series_info.get("main_series_imdb_id")
                        main_series_title = main_series_info.get("main_series_title")
                        main_series_year = main_series_info.get("main_series_year")
                        
                        if main_series_imdb_id:
                            result["imdb_id"] = main_series_imdb_id
                            series_info["main_series_imdb_id"] = main_series_imdb_id
                            print(f"✓ 获取到主系列IMDB ID: {main_series_imdb_id}")
                        
                        if main_series_title:
                            series_info["main_title"] = main_series_title
                            series_info["main_series_title"] = main_series_title
                            print(f"✓ 获取到主系列标题: {main_series_title}")
                        
                        if main_series_year:
                            series_info["main_series_year"] = main_series_year
                            print(f"✓ 获取到主系列年份: {main_series_year}")
                        
                        series_info["source"] = "first_episode_imdb"
                        series_info["detected"] = True
                    else:
                        print("⚠ 无法从第一集获取主系列信息，使用标题提取方式")
                
                if not series_info:
                    series_info = anthology_handler.extract_main_series_info(result)
                
                if series_info:
                    result["series_info"] = series_info
                    print(f"提取主系列: {series_info.get('main_title')}")
                
                if not result["imdb_id"]:
                    print("IMDB ID为空，尝试从多个来源获取...")
                    enhanced_imdb_id = await anthology_handler.get_imdb_id_from_multiple_sources(
                        result, 
                        series_info
                    )
                    if enhanced_imdb_id:
                        result["imdb_id"] = enhanced_imdb_id
                        print(f"增强获取到IMDB ID: {enhanced_imdb_id}")
                
                search_variants = anthology_handler.generate_search_variants(
                    result,
                    series_info
                )
                result["search_variants"] = search_variants
                
                print("==================\n")
            else:
                result["search_variants"] = anthology_handler.generate_search_variants(result, None)
        
        if not request or not (await request.is_disconnected()):
            print("\n=== TMDB 返回信息 ===")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            print("==================\n")
        
        return result
        
    except Exception as e:
        if not request or not (await request.is_disconnected()):
            print(f"获取TMDB信息时出错: {e}")
            import traceback
            print(f"详细错误信息:\n{traceback.format_exc()}")
        return None

def extract_year(year_str):
    """从字符串中提取年份"""
    if not year_str:
        return None
    
    year_str = str(year_str)
    
    range_match = re.search(r'(\d{4})\s*[–-]\s*(\d{4})?', year_str)
    if range_match:
        return int(range_match.group(1))
    
    match = re.search(r'\b(19\d{2}|20\d{2})\b', year_str)
    if match:
        return int(match.group(1))
    
    return None

async def calculate_match_degree(tmdb_info, result, platform=""):
    """计算搜索结果与TMDB信息的匹配度"""
    import traceback as tb
    try:
        if "match_score" in result:
            return result["match_score"]      
          
        score = 0
        
        if tmdb_info.get("is_anthology"):
            search_variant_used = result.get("search_variant_used")
            if not search_variant_used:
                search_variants = tmdb_info.get("search_variants", [])
                search_variant_used = search_variants[0] if search_variants else {}
            
            if search_variant_used.get("strategy") == "anthology_series":
                result_title = result.get("title", "").lower()
                search_title = search_variant_used.get("title", "").lower()
                
                cleaned_result_title = re.sub(r'\s*\([^)]*\)\s*', '', result_title).strip()
                cleaned_search_title = search_title.strip()
                
                is_exact_match = (cleaned_result_title == cleaned_search_title)
                is_contained = (cleaned_search_title in cleaned_result_title.split() or 
                               cleaned_result_title.startswith(cleaned_search_title + " ") or
                               cleaned_result_title == cleaned_search_title)
                
                print(f"搜索标题: '{cleaned_search_title}'")
                
                if is_exact_match:
                    score = 70
                elif is_contained:
                    score = 65
                else:
                    fuzzy_score = fuzz.ratio(search_title, result_title)
                    if fuzzy_score >= 95:
                        score = 60
                    else:
                        score = 0
                        return 0
                
                result_year_text = result.get("year", "")
                tmdb_year = tmdb_info.get("year", "")
                search_year = search_variant_used.get("year", "")
                
                if platform in ("rottentomatoes", "metacritic"):
                    series_info = tmdb_info.get("series_info", {})
                    main_series_year = series_info.get("main_series_year")
                    if main_series_year:
                        tmdb_year = main_series_year
                
                result_year_int = extract_year(result_year_text)
                tmdb_year_int = extract_year(tmdb_year)
                
                if result_year_int and tmdb_year_int:
                    if "–" in result_year_text or "-" in result_year_text:
                        end_year_match = re.search(r'[–-]\s*(\d{4})', result_year_text)
                        if end_year_match:
                            end_year = int(end_year_match.group(1))
                            if result_year_int <= tmdb_year_int <= end_year:
                                score += 25
                        else:
                            if result_year_int <= tmdb_year_int:
                                score += 30
                    else:
                        year_diff = abs(result_year_int - tmdb_year_int)
                        
                        if year_diff == 0:
                            score += 20
                        elif year_diff <= 3:
                            score += 15
                        elif result_year_int < tmdb_year_int and year_diff <= 5:
                            score += 10
                        elif result_year_int < tmdb_year_int and year_diff <= 10:
                            score += 5

                elif not result_year_int:
                    pass
                
                subtitle_hint = search_variant_used.get("subtitle_hint", "")
                if subtitle_hint:
                    subtitle_lower = subtitle_hint.lower()
                    if subtitle_lower in result_title:
                        score += 40
                    else:
                        subtitle_match = fuzz.partial_ratio(subtitle_lower, result_title)
                        if subtitle_match > 70:
                            score += subtitle_match * 0.3
                
                if platform == "imdb":
                    if "–" in result_year_text or "-" in result_year_text:
                        if result_year_int and tmdb_year_int:
                            if result_year_int <= tmdb_year_int:
                                score += 15
                
                print(f"{platform}[选集剧匹配]最终得分: {score}")
                return score
        
        if platform == "douban":
            result_title = result.get("title", "").lower()
            parts = result_title.split('(')[0].strip()
            title_parts = parts.split(' ')
            
            tmdb_titles = [
                tmdb_info.get("title", "").lower(),
                tmdb_info.get("original_title", "").lower(),
                tmdb_info.get("zh_title", "").lower()
            ]
            
            title_scores = []
            
            for tmdb_title in tmdb_titles:
                if tmdb_title:
                    whole_score = fuzz.ratio(tmdb_title, result_title)
                    title_scores.append(whole_score)
                    
                    partial_score = fuzz.partial_ratio(tmdb_title, result_title)
                    title_scores.append(partial_score)
            
            for tmdb_title in tmdb_titles:
                if tmdb_title:
                    for part in title_parts:
                        if part and len(part) > 1:
                            part_score = fuzz.ratio(tmdb_title, part)
                            title_scores.append(part_score)
            
            if title_scores:
                max_title_score = max(title_scores)
                score = max_title_score * 0.6
            
            if tmdb_info.get("type") == "tv":
                total_seasons = len([s for s in tmdb_info.get("seasons", []) if s.get("season_number", 0) > 0])
                is_single_season = total_seasons == 1
                
                result_season_number = None
                
                if is_single_season:
                    has_season_marker = (
                        re.search(r'第[一二三四五六七八九十百]+季', result.get("title", "")) or
                        re.search(r'season\s*\d+', result.get("title", "").lower())
                    )
                    
                    if not has_season_marker:
                        result_season_number = 1
                
                if result_season_number is None:
                    season_match = re.search(r'第([一二三四五六七八九十百]+)季', result.get("title", ""))
                    if season_match:
                        chinese_season_number = season_match.group(1)
                        result_season_number = chinese_to_arabic(chinese_season_number)
                    else:
                        season_match = re.search(r'season\s*(\d+)', result.get("title", "").lower())
                        if season_match:
                            result_season_number = int(season_match.group(1))
                
                if result_season_number is not None:
                    for season in tmdb_info.get("seasons", []):
                        if season.get("season_number") == result_season_number:
                            if total_seasons > 1:
                                score += 50
                            else:
                                score += 30
                            break
            
            try:
                if tmdb_info.get("type") == "movie":
                    tmdb_year = str(tmdb_info.get("year", ""))
                    result_year = str(result.get("year", ""))
                    
                    if tmdb_year and result_year:
                        tmdb_year_int = extract_year(tmdb_year)
                        result_year_int = extract_year(result_year)
                        
                        if tmdb_year_int and result_year_int:
                            year_diff = abs(tmdb_year_int - result_year_int)
                            
                            if year_diff == 0:
                                score += 30
                            elif year_diff == 1:
                                score += 15
                            elif year_diff == 2:
                                score += 5
                            elif year_diff > 2:
                                return 0
                        else:
                            print(f"年份无法提取: TMDB={tmdb_year}, 结果={result_year}")
                else: 
                    total_seasons = len([s for s in tmdb_info.get("seasons", []) if s.get("season_number", 0) > 0])
                    is_single_season = total_seasons == 1
                    
                    result_year = str(result.get("year", ""))
                    
                    result_season_number = None
                    season_match = re.search(r'第([一二三四五六七八九十百]+)季', result.get("title", ""))
                    if season_match:
                        chinese_season_number = season_match.group(1)
                        result_season_number = chinese_to_arabic(chinese_season_number)
                    else:
                        season_match = re.search(r'season\s*(\d+)', result.get("title", "").lower())
                        if season_match:
                            result_season_number = int(season_match.group(1))
                    
                    if is_single_season and not result_season_number:
                        result_season_number = 1
                    
                    if result_season_number is not None:
                        season_air_date = None
                        for season in tmdb_info.get("seasons", []):
                            if season.get("season_number") == result_season_number:
                                season_air_date = season.get("air_date", "")[:4]
                                break
                        
                        if season_air_date and result_year:
                            season_year_int = extract_year(season_air_date)
                            result_year_int = extract_year(result_year)
                            
                            if season_year_int and result_year_int:
                                year_diff = abs(season_year_int - result_year_int)
                                
                                if year_diff == 0:
                                    score += 20
                                elif year_diff == 1:
                                    score += 10
                                elif year_diff == 2:
                                    score += 5
                                elif year_diff > 2:
                                    return 0
                    else:
                        if is_single_season:
                            for season in tmdb_info.get("seasons", []):
                                if season.get("season_number") == 1:
                                    season_air_date = season.get("air_date", "")[:4]
                                    if season_air_date and result_year:
                                        season_year_int = extract_year(season_air_date)
                                        result_year_int = extract_year(result_year)
                                        
                                        if season_year_int and result_year_int:
                                            year_diff = abs(season_year_int - result_year_int)
                                            
                                            if year_diff == 0:
                                                score += 20
                                            elif year_diff == 1:
                                                score += 10
                                            elif year_diff == 2:
                                                score += 5
                                            elif year_diff > 2:
                                                return 0
                                    break

            except (ValueError, TypeError) as e:
                print(f"年份比较出错: {e}")
                print(f"错误详情: {tb.format_exc()}")
            
            if tmdb_info.get("imdb_id") and result.get("imdb_id"):
                if tmdb_info["imdb_id"] == result["imdb_id"]:
                    score += 10   
        else:
            tmdb_titles = [
                tmdb_info.get("title", "").lower(),
                tmdb_info.get("original_title", "").lower(),
                tmdb_info.get("en_title", "").lower(),
                tmdb_info.get("zh_title", "").lower() if platform == "douban" else ""
            ]
            tmdb_titles = [t for t in tmdb_titles if t]
            result_title = result.get("title", "").lower()
            
            result_title = re.sub(r'\s*\(\d{4}\)\s*', '', result_title)
            
            title_scores = [fuzz.ratio(t, result_title) for t in tmdb_titles if t]
            if title_scores:
                title_score = max(title_scores)
                score += title_score * 0.6
            
            try:
                tmdb_year = str(tmdb_info.get("year", ""))
                result_year = str(result.get("year", ""))
                
                if tmdb_year and result_year:
                    tmdb_year_int = extract_year(tmdb_year)
                    result_year_int = extract_year(result_year)
                    
                    if tmdb_year_int and result_year_int:
                        year_diff = abs(tmdb_year_int - result_year_int)
                        if year_diff == 0:
                            score += 30
                        elif year_diff == 1:
                            score += 15

            except (ValueError, TypeError) as e:
                print(f"年份比较出错: {e}")
                print(f"错误详情: {tb.format_exc()}")
            
            if tmdb_info.get("imdb_id") and result.get("imdb_id"):
                if tmdb_info["imdb_id"] == result["imdb_id"]:
                    score += 10
        
        threshold = {
            "douban": 70,
            "imdb": 70,
            "letterboxd": 70,
            "rottentomatoes": 70,
            "metacritic": 70
        }.get(platform, 70)
        
        if score >= threshold:
            return score
        else:
            return 0
            
    except Exception as e:
        print(f"{platform} 计算匹配度时出错: {e}")
        import traceback
        print(traceback.format_exc())
        return 0

async def check_rate_limit(page, platform: str) -> dict | None:
    """检查页面是否出现访问限制"""
    rate_limit_rules = {
        "douban": {
            "selectors": [
                '.note-text',
                '.error-content',
                '#error-500-page',
                '.restriction-notice',
                'h1:has-text("有异常请求")',
                'div:has-text("有异常请求从你的IP发出")'
            ],
            "phrases": [
                "访问太频繁",
                "访问受限",
                "请求过于频繁",
                "操作太频繁",
                "请求次数过多",
                "登录跳转",
                "搜索访问太频繁",
                "有异常请求",
                "异常请求从你的IP发出",
                "你访问豆瓣的方式有点像机器人程序",
                "证明你是人类",
                "点击证明",
            ]
        },
        "imdb": {
            "selectors": [
                '.error-message',
                '#error-page',
                '.rate-limit-page'
            ],
            "phrases": [
                "rate limit exceeded",
                "too many requests",
                "access denied",
                "temporary block"
            ]
        },
        "rottentomatoes": {
            "selectors": [
                '.error-text',
                '#rate-limit-message',
                '.captcha-page'
            ],
            "phrases": [
                "too many requests",
                "rate limited",
                "please try again later",
                "verify you are human"
            ]
        },
        "letterboxd": {
            "selectors": [
                '.error-page',
                '.rate-limit-message',
                '.blocked-content',
                '.captcha-container',
                'h1:has-text("Access Denied")',
               'div:has-text("You are being rate limited")'
            ],
            "phrases": [
                "rate limit exceeded",
                "too many requests",
                "Just a moment",
                "you are being rate limited",
                "access denied",
                "please wait and try again",
                "temporarily blocked"
            ]
        },
        "metacritic": {
            "selectors": [
                '.error-message',
                '#block-message',
                '.rate-limit-notice'
            ],
            "phrases": [
                "access denied",
                "too many requests",
                "please wait",
                "rate limited"
            ]
        }
    }

    if platform not in rate_limit_rules:
        return None

    rules = rate_limit_rules[platform]
    
    if platform == "douban":
        page_html = await page.content()
        if "error code: 008" in page_html:
            print("豆瓣访问频率限制: error code 008")
            return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "访问频率限制"}
        if (
            "你访问豆瓣的方式有点像机器人程序" in page_html
            or "点击证明" in page_html
        ):
            print("豆瓣人机验证页（机器人拦截）")
            return {
                "status": RATING_STATUS["RATE_LIMIT"],
                "status_reason": "豆瓣人机验证：请在本地浏览器打开 douban.com 完成验证后，更新账号中的豆瓣 Cookie 再试",
            }
    
    if platform == "letterboxd":
        try:
            title = await page.title()
            content = await page.content()
            if title and "Just a moment" in title:
                print("Letterboxd: 检测到 Cloudflare 安全验证页 (title)")
                return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "Cloudflare 安全验证拦截，请稍后重试"}
            if "Enable JavaScript and cookies to continue" in content or "cf_chl_opt" in content or "challenge-platform" in content:
                print("Letterboxd: 检测到 Cloudflare 安全验证页 (content)")
                return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "Cloudflare 安全验证拦截，请稍后重试"}
        except Exception as e:
            print(f"Letterboxd Cloudflare 检测异常: {e}")
    
    page_text = await page.locator("body").text_content()
    if page_text is None:
        page_text = ""
    if any(phrase in page_text for phrase in rules["phrases"]):
        print(f"{platform} 访问频率限制: 检测到限制文本")
        return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "访问频率限制"}
    
    for selector in rules["selectors"]:
        elem = await page.query_selector(selector)
        if elem:
            text = await elem.inner_text()
            if any(phrase.lower() in text.lower() for phrase in rules["phrases"]):
                print(f"{platform} 访问频率限制: {text}")
                return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "访问频率限制"}
    
    return None

async def _is_cloudflare_challenge(page) -> bool:
    """检测当前页面是否为 Cloudflare 安全验证"""
    try:
        title = await page.title()
        if title and "Just a moment" in title:
            return True
        content = await page.content()
        if "Enable JavaScript and cookies to continue" in content or "cf_chl_opt" in content or "challenge-platform" in content:
            return True
        return False
    except Exception:
        return False

def _parse_letterboxd_cookie_string(s: str):
    """解析 .env 中的 LETTERBOXD_COOKIE 字符串"""
    if not s or not s.strip():
        return []
    out = []
    for part in s.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, _, value = part.partition("=")
        name, value = name.strip(), value.strip()
        if name:
            out.append({"name": name, "value": value, "domain": ".letterboxd.com", "path": "/"})
    return out

def _parse_douban_cookie_string(s: str):
    """解析豆瓣 Cookie 字符串"""
    if not s or not s.strip():
        return []
    out = []
    for part in s.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, _, value = part.partition("=")
        name, value = name.strip(), value.strip()
        if name:
            out.append({"name": name, "value": value, "domain": ".douban.com", "path": "/"})
    return out

async def search_platform(platform, tmdb_info, request=None, douban_cookie=None):
    """在各平台搜索并返回搜索结果"""
    try:
        if request and await request.is_disconnected():
            return {"status": "cancelled"}

        if platform == "trakt":
            return [{"use_api": True, "title": tmdb_info.get("title", "")}]

        if platform == "imdb" and tmdb_info.get("imdb_id"):
            imdb_id = tmdb_info["imdb_id"]
            return [{
                "title": tmdb_info["title"],
                "year": tmdb_info.get("year", ""),
                "url": f"https://www.imdb.com/title/{imdb_id}/",
                "imdb_id": imdb_id,
                "direct_match": True
            }]

        is_anthology = tmdb_info.get("is_anthology", False)
        series_info = tmdb_info.get("series_info", {})
        
        if is_anthology and platform in ("rottentomatoes", "metacritic") and series_info:
            main_series_title = series_info.get("main_series_title") or series_info.get("main_title")
            main_series_year = series_info.get("main_series_year")
            
            if main_series_title:
                print(f"[{platform}] 选集剧使用主系列标题搜索: {main_series_title} ({main_series_year})")
                search_tmdb_info = tmdb_info.copy()
                search_tmdb_info["title"] = main_series_title
                search_tmdb_info["original_title"] = main_series_title
                search_tmdb_info["en_title"] = main_series_title
                if main_series_year:
                    search_tmdb_info["year"] = main_series_year
                
                search_url = construct_search_url(main_series_title, tmdb_info.get("type", "tv"), platform, search_tmdb_info)
                
                async def execute_search(browser):
                    context = None
                    try:
                        selected_user_agent = random.choice(USER_AGENTS)
                        context_options = {
                            'viewport': {'width': 1280, 'height': 720},
                            'user_agent': selected_user_agent,
                            'bypass_csp': True,
                            'ignore_https_errors': True,
                            'java_script_enabled': True,
                        }
                        context = await browser.new_context(**context_options)
                        page = await context.new_page()
                        page.set_default_timeout(30000)
                        
                        if platform == "rottentomatoes":
                            results = await handle_rt_search(page, search_url, search_tmdb_info)
                        elif platform == "metacritic":
                            results = await handle_metacritic_search(page, search_url, search_tmdb_info)
                        else:
                            results = []
                        
                        return results
                    finally:
                        if context:
                            try:
                                await context.close()
                            except:
                                pass
                
                try:
                    search_results = await browser_pool.execute_in_browser(execute_search)
                    if search_results:
                        if isinstance(search_results, list):
                            threshold = 60
                            print(f"使用选集剧阈值: {threshold}")
                            print(f"找到 {len(search_results)} 个 {platform} 搜索结果")
                            
                            matched_results = []
                            for result in search_results:
                                if isinstance(result, dict):
                                    result["used_main_series"] = True
                                    result["main_series_title"] = main_series_title
                                    result["main_series_year"] = main_series_year
                                    
                                    variant_info = {
                                        "title": main_series_title,
                                        "year": main_series_year or "",
                                        "strategy": "anthology_series",
                                        "type": "main_series_with_year" if main_series_year else "main_series_no_year"
                                    }
                                    result["search_variant_used"] = variant_info
                                    
                                    if "match_score" not in result:
                                        match_score = await calculate_match_degree(search_tmdb_info, result, platform)
                                    else:
                                        match_score = result["match_score"]
                                    
                                    if platform == "metacritic":
                                        print(f"  Metacritic匹配: '{result.get('title')}' ({result.get('year')}) - 分数: {match_score}, 阈值: {threshold}")
                                    
                                    if match_score >= threshold:
                                        matched_results.append(result)
                            
                            if matched_results:
                                print(f"{platform} 找到 {len(matched_results)} 个匹配结果")
                                return matched_results
                            else:
                                if platform == "metacritic":
                                    print(f"Metacritic未找到匹配结果（所有结果分数都低于阈值 {threshold}）")
                                return None
                        elif isinstance(search_results, dict) and "status" in search_results:
                            return search_results
                        else:
                            return None
                except Exception as e:
                    print(f"[{platform}] 使用主系列信息搜索失败: {e}")
        
        search_variants = tmdb_info.get("search_variants", [])
        
        if not search_variants:
            if platform == "douban":
                search_title = tmdb_info["zh_title"] or tmdb_info["original_title"]
            elif platform in ("imdb", "rottentomatoes", "metacritic"):
                original_title = tmdb_info.get("original_title", "")
                en_title = tmdb_info.get("en_title", "")
                
                def is_english_text(text):
                    if not text:
                        return False
                    try:
                        ascii_count = sum(1 for c in text if ord(c) < 128)
                        return ascii_count / len(text) > 0.8
                    except:
                        return False
                
                if original_title and is_english_text(original_title):
                    search_title = original_title
                elif en_title:
                    search_title = en_title
                else:
                    search_title = original_title or tmdb_info.get("title") or tmdb_info.get("name") or ""
            else:
                search_title = tmdb_info["title"] or tmdb_info.get("name") or tmdb_info["original_title"]
            
            search_variants = [{
                "title": search_title,
                "year": tmdb_info.get("year", ""),
                "type": "default",
                "strategy": "standalone",
                "priority": 1
            }]
        
        media_type = tmdb_info["type"]
        
        async def execute_single_search(search_title, variant_info, browser):
            """执行单个搜索变体的搜索"""
            context = None
            search_url_or_urls = construct_search_url(search_title, media_type, platform, tmdb_info)
            
            if platform == "letterboxd" and isinstance(search_url_or_urls, list):
                search_urls = search_url_or_urls
            else:
                search_urls = [search_url_or_urls] if search_url_or_urls else []
            
            try:
                selected_user_agent = random.choice(USER_AGENTS)

                context_options = {
                    'viewport': {'width': 1280, 'height': 720},
                    'user_agent': selected_user_agent,
                    'bypass_csp': True,
                    'ignore_https_errors': True,
                    'java_script_enabled': True,
                    'has_touch': False,
                    'is_mobile': False,
                    'locale': 'zh-CN',
                    'timezone_id': 'Asia/Shanghai',
                    'extra_http_headers': {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'DNT': '1',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1'
                    }
                }

                context = await browser.new_context(**context_options)

                if platform == "douban":
                    await _apply_douban_light_blocking_routes(context)
                else:
                    await context.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}", lambda route: route.abort())
                    await context.route("**/(analytics|tracking|advertisement)", lambda route: route.abort())
                    await context.route("**/beacon/**", lambda route: route.abort())
                    await context.route("**/telemetry/**", lambda route: route.abort())
                    await context.route("**/stats/**", lambda route: route.abort())

                page = await context.new_page()
                page.set_default_timeout(20000)
                if platform == "letterboxd":
                    try:
                        from playwright_stealth import stealth_async  # type: ignore[reportMissingImports]
                        await stealth_async(page)
                    except Exception:
                        pass
                elif platform == "douban":
                    await _playwright_stealth_optional(page)

                    if douban_cookie:
                        headers['Cookie'] = douban_cookie
                        print(f"✅ 豆瓣请求使用用户自定义Cookie（长度: {len(douban_cookie)}）")
                        dc = _parse_douban_cookie_string(douban_cookie)
                        if dc:
                            await context.add_cookies(dc)
                    else:
                        print("⚠️ 未提供豆瓣Cookie，使用默认方式")
                    if headers:
                        await page.set_extra_http_headers(headers)

                async def log_request(req):
                    if req.resource_type == "document":
                        pass
                    page.remove_listener('request', log_request)

                page.on('request', log_request)
                
                results = None
                
                try:
                    async def check_request():
                        if request and await request.is_disconnected():
                            print("请求已被取消,停止执行")
                            raise RequestCancelledException()

                    if platform == "letterboxd" and len(search_urls) > 1:
                        for idx, search_url in enumerate(search_urls):
                            if not search_url:
                                continue
                            print(f"{platform} 搜索URL [{idx+1}/{len(search_urls)}]: {search_url}")
                            await check_request()
                            results = await handle_letterboxd_search(page, search_url, tmdb_info)
                            
                            if results and not (isinstance(results, dict) and results.get("status") == RATING_STATUS["NO_FOUND"]):
                                break
                        
                        if results and isinstance(results, dict) and results.get("status") == RATING_STATUS["NO_FOUND"]:
                            print(f"Letterboxd所有搜索方式都未找到结果，确认未收录")
                            return {"status": RATING_STATUS["NO_FOUND"], "status_reason": "平台未收录"}
                    else:
                        if not search_urls:
                            print(f"{platform} 无法构造搜索URL")
                            return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "无法构造搜索URL"}
                        search_url = search_urls[0]
                        if search_url:
                            print(f"{platform} 搜索URL: {search_url}")
                            await check_request()
                            if platform == "douban":
                                results = await handle_douban_search(page, search_url)
                            elif platform == "imdb":
                                results = await handle_imdb_search(page, search_url)
                            elif platform == "letterboxd":
                                results = await handle_letterboxd_search(page, search_url, tmdb_info)
                            elif platform == "rottentomatoes":
                                results = await handle_rt_search(page, search_url, tmdb_info)
                            elif platform == "metacritic":
                                results = await handle_metacritic_search(page, search_url, tmdb_info)
                            else:
                                print(f"平台 {platform} 不支持通过搜索页面")
                                return None
                        else:
                            print(f"{platform} 搜索URL为空")
                            return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "搜索URL为空"}

                    await check_request()
                    if isinstance(results, dict) and "status" in results:
                        if results["status"] == RATING_STATUS["RATE_LIMIT"]:
                            reason = results.get("status_reason") or "访问频率限制"
                            print(f"{platform} 访问频率限制: {reason}")
                            return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": reason} 
                        elif results["status"] == RATING_STATUS["TIMEOUT"]:
                            print(f"{platform} 请求超时")
                            return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"}
                        elif results["status"] == RATING_STATUS["FETCH_FAILED"]:
                            print(f"{platform} 获取失败")
                            return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}
                        elif results["status"] == RATING_STATUS["NO_FOUND"]:
                            print(f"{platform}平台未收录此影视")
                            return {"status": RATING_STATUS["NO_FOUND"], "status_reason": "平台未收录"}

                    await check_request()
                    if not isinstance(results, list):
                        print(f"{platform} 获取失败")
                        return create_error_rating_data(platform, media_type)

                    print(f"找到 {len(results)} 个 {platform} 搜索结果")

                    await check_request()
                    if variant_info.get("strategy") == "anthology_series":
                        threshold = 60
                        print(f"使用选集剧阈值: {threshold}")
                    else:
                        threshold = {
                            "douban": 70,
                            "imdb": 70,
                            "letterboxd": 70,
                            "rottentomatoes": 70,
                            "metacritic": 70
                        }.get(platform, 70)
                        if platform == "metacritic" and extract_year(tmdb_info.get("year")) is None:
                            threshold = 60

                    matched_results = []
                    for result in results:
                        await check_request()
                        result["search_variant_used"] = variant_info
                        
                        if "match_score" in result:
                            match_score = result["match_score"]
                        else:
                            match_score = await calculate_match_degree(tmdb_info, result, platform)
                            result["match_score"] = match_score

                        if platform == "metacritic" and variant_info.get("strategy") == "anthology_series":
                            print(f"  Metacritic匹配: '{result.get('title')}' ({result.get('year')}) - 分数: {match_score}, 阈值: {threshold}")

                        if match_score >= threshold:
                            matched_results.append(result)
                        else:
                            pass

                    if not matched_results:
                        if platform == "metacritic":
                            print(f"Metacritic未找到匹配结果（所有结果分数都低于阈值 {threshold}）")
                        return None

                    matched_results.sort(key=lambda x: x.get("match_score", 0), reverse=True)
                    if len(matched_results) > MAX_MATCH_CANDIDATES_PER_PLATFORM:
                        matched_results = matched_results[:MAX_MATCH_CANDIDATES_PER_PLATFORM]
                    print(f"{platform} 找到 {len(matched_results)} 个匹配结果")
                    return matched_results

                except RequestCancelledException:
                    print("所有请求已取消")
                    return {"status": "cancelled"}
                except Exception as e:
                    print(f"处理搜索时出错: {e}")
                    print(traceback.format_exc())
                    if "Timeout" in str(e):
                        return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"} 
                    return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}

            finally:
                if context:
                    try:
                        await context.close()
                    except Exception:
                        pass
        
        for i, variant in enumerate(search_variants, 1):
            if request and await request.is_disconnected():
                return {"status": "cancelled"}
            
            search_title = variant["title"]
            
            try:
                results = await browser_pool.execute_in_browser(
                    lambda browser, st=search_title, v=variant: execute_single_search(st, v, browser)
                )
                
                if isinstance(results, dict) and "status" in results:
                    if results.get("status") in (
                        RATING_STATUS["NO_FOUND"],
                        RATING_STATUS["RATE_LIMIT"],
                        RATING_STATUS["TIMEOUT"],
                        RATING_STATUS["FETCH_FAILED"],
                    ):
                        return results
                    if i == len(search_variants):
                        return results
                    continue
                
                if isinstance(results, list) and len(results) > 0:
                    print(f"变体成功！{platform} 找到 {len(results)} 个匹配结果")
                    for result in results:
                        result['search_variant_used'] = variant
                    return results
                
            except Exception as e:
                if i == len(search_variants):
                    return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": str(e)}
                continue
        
        print(f"\n所有 {len(search_variants)} 个搜索变体都失败")
        
        if platform == "douban" and tmdb_info.get("imdb_id"):
            imdb_id = tmdb_info["imdb_id"]
            print(f"\n[豆瓣备用策略] 尝试使用IMDB ID搜索: {imdb_id}")
            
            try:
                imdb_search_url = f"https://search.douban.com/movie/subject_search?search_text={imdb_id}"
                
                async def execute_imdb_search(browser):
                    context = None
                    try:
                        selected_user_agent = random.choice(USER_AGENTS)
                        context_options = {
                            'viewport': {'width': 1280, 'height': 720},
                            'user_agent': selected_user_agent,
                            'bypass_csp': True,
                            'ignore_https_errors': True,
                            'java_script_enabled': True,
                            'has_touch': False,
                            'is_mobile': False,
                            'locale': 'zh-CN',
                            'timezone_id': 'Asia/Shanghai',
                            'extra_http_headers': {
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                                'Accept-Encoding': 'gzip, deflate, br',
                                'DNT': '1',
                                'Connection': 'keep-alive',
                                'Upgrade-Insecure-Requests': '1',
                                'Sec-Fetch-Dest': 'document',
                                'Sec-Fetch-Mode': 'navigate',
                                'Sec-Fetch-Site': 'none',
                                'Sec-Fetch-User': '?1'
                            }
                        }
                        
                        context = await browser.new_context(**context_options)
                        await _apply_douban_light_blocking_routes(context)
                        
                        page = await context.new_page()
                        page.set_default_timeout(20000)
                        await _playwright_stealth_optional(page)
                        
                        headers = {}
                        if douban_cookie:
                            headers['Cookie'] = douban_cookie
                            print(f"✅ 豆瓣请求使用用户自定义Cookie（长度: {len(douban_cookie)}）")
                            dc = _parse_douban_cookie_string(douban_cookie)
                            if dc:
                                await context.add_cookies(dc)
                        else:
                            print("⚠️ 未提供豆瓣Cookie，使用默认方式")
                        if headers:
                            await page.set_extra_http_headers(headers)
                        
                        results = await handle_douban_search(page, imdb_search_url)
                        
                        if isinstance(results, dict) and "status" in results:
                            return results
                        
                        if isinstance(results, list) and len(results) > 0:
                            print(f"IMDB ID搜索成功！找到 {len(results)} 个结果")
                            if len(results) > 0:
                                results[0]["match_score"] = 100
                                results[0]["search_variant_used"] = {
                                    "title": imdb_id,
                                    "strategy": "imdb_id",
                                    "type": "fallback"
                                }
                            return results
                        
                        return None
                        
                    finally:
                        if context:
                            try:
                                await context.close()
                            except Exception:
                                pass
                
                results = await browser_pool.execute_in_browser(execute_imdb_search)
                
                if isinstance(results, list) and len(results) > 0:
                    return results
                elif isinstance(results, dict) and "status" in results:
                    print(f"IMDB ID备用策略失败: {results.get('status_reason', results.get('status'))}")
                else:
                    print(f"IMDB ID备用策略未找到结果")
                    
            except Exception as e:
                print(f"IMDB ID备用策略出错: {e}")
        
        return {"status": RATING_STATUS["NO_FOUND"], "status_reason": "所有搜索策略都未找到匹配"}

    except Exception as e:
        print(f"搜索 {platform} 时出错: {e}")
        print(traceback.format_exc())
        return []

async def _apply_douban_light_blocking_routes(context) -> None:
    """仅拦截明显跟踪/广告与打点类资源"""
    await context.route(
        re.compile(
            r"google-analytics\.com|googletagmanager\.com|g\.doubleclick\.net|scorecardresearch\.com",
            re.I,
        ),
        lambda route: route.abort(),
    )
    await context.route(
        re.compile(r".*/(analytics|tracking|advertisement)(/|$|\?)", re.I),
        lambda route: route.abort(),
    )
    await context.route("**/beacon/**", lambda route: route.abort())
    await context.route("**/telemetry/**", lambda route: route.abort())
    await context.route("**/stats/**", lambda route: route.abort())

async def _playwright_stealth_optional(page) -> None:
    try:
        from playwright_stealth import stealth_async  # type: ignore[reportMissingImports]

        await stealth_async(page)
    except Exception:
        pass

async def _new_douban_browser_context(browser, request=None, douban_cookie=None):
    """创建用于豆瓣的 Playwright 上下文与页面"""
    selected_user_agent = random.choice(USER_AGENTS)
    base_vw = random.choice(
        ((1280, 720), (1366, 768), (1440, 900), (1536, 864), (1920, 1080))
    )
    vw = base_vw[0] + random.randint(-48, 48)
    vh = base_vw[1] + random.randint(-40, 40)
    vw, vh = max(vw, 960), max(vh, 540)
    context_options = {
        "viewport": {"width": vw, "height": vh},
        "user_agent": selected_user_agent,
        "bypass_csp": True,
        "ignore_https_errors": True,
        "java_script_enabled": True,
        "has_touch": False,
        "is_mobile": False,
        "locale": "zh-CN",
        "timezone_id": "Asia/Shanghai",
        "extra_http_headers": {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
        },
    }

    context = await browser.new_context(**context_options)
    await _apply_douban_light_blocking_routes(context)
    page = await context.new_page()
    page.set_default_timeout(20000)
    await _playwright_stealth_optional(page)

    headers = {}
    if douban_cookie:
        headers["Cookie"] = douban_cookie
        print(f"✅ 豆瓣请求使用用户自定义Cookie（长度: {len(douban_cookie)}）")
        parsed = _parse_douban_cookie_string(douban_cookie)
        if parsed:
            await context.add_cookies(parsed)
            print("豆瓣: 已注入用户 Cookie 到浏览器")
    else:
        print("⚠️ 未提供豆瓣Cookie，使用默认方式")
    if headers:
        await page.set_extra_http_headers(headers)

    return context, page

def _normalize_douban_detail_url(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return u
    if u.startswith("http://") or u.startswith("https://"):
        return u
    if u.startswith("//"):
        return "https:" + u
    if u.startswith("/"):
        return "https://movie.douban.com" + u
    return "https://movie.douban.com/" + u

_douban_inflight_lock = asyncio.Lock()
_douban_inflight_tasks: dict[str, asyncio.Task] = {}

def _douban_singleflight_key(
    media_type: str, tmdb_info: dict, douban_cookie: Optional[str]
) -> str:
    tid = str(tmdb_info.get("id") or tmdb_info.get("tmdb_id") or "")
    ck = (douban_cookie or "").strip()
    h = hashlib.sha256(ck.encode("utf-8")).hexdigest()[:16] if ck else "anon"
    return f"{media_type}:{tid}:{h}"

async def _await_same_douban_fetch(sf_key: str, factory):
    """相同的并发请求共用一次豆瓣流水线"""
    loop = asyncio.get_running_loop()
    async with _douban_inflight_lock:
        existing = _douban_inflight_tasks.get(sf_key)
        if existing is not None and not existing.done():
            task = existing
        else:

            async def _runner():
                return await factory()

            task = asyncio.create_task(_runner())
            _douban_inflight_tasks[sf_key] = task

            def _cleanup(done: asyncio.Task) -> None:
                def _pop():
                    if _douban_inflight_tasks.get(sf_key) is done:
                        _douban_inflight_tasks.pop(sf_key, None)

                loop.call_soon(_pop)

            task.add_done_callback(_cleanup)
    return await task

async def douban_search_and_extract_rating(
    media_type, tmdb_info, request=None, douban_cookie=None
):
    """在单次浏览器会话内完成豆瓣搜索与详情抓取"""
    if request and await request.is_disconnected():
        return {"status": "cancelled"}

    async def pipeline(browser):
        context = None
        try:
            context, page = await _new_douban_browser_context(
                browser, request, douban_cookie
            )

            async def check_req():
                if request and await request.is_disconnected():
                    raise RequestCancelledException()

            search_variants = tmdb_info.get("search_variants", [])
            if not search_variants:
                search_title = tmdb_info["zh_title"] or tmdb_info["original_title"]
                search_variants = [
                    {
                        "title": search_title,
                        "year": tmdb_info.get("year", ""),
                        "type": "default",
                        "strategy": "standalone",
                        "priority": 1,
                    }
                ]

            merged_results = None
            winning_variant = None

            fast_mode = True

            for variant in search_variants:
                await check_req()
                search_title = variant["title"]
                search_url = construct_search_url(
                    search_title, media_type, "douban", tmdb_info
                )
                if not search_url:
                    continue
                print(f"douban 搜索URL: {search_url}")
                await check_req()
                results = await handle_douban_search(page, search_url, fast_mode=fast_mode)

                if isinstance(results, dict) and "status" in results:
                    st = results["status"]
                    if st == RATING_STATUS["RATE_LIMIT"]:
                        reason = results.get("status_reason") or "访问频率限制"
                        return create_rating_data(RATING_STATUS["RATE_LIMIT"], reason)
                    if st == RATING_STATUS["TIMEOUT"]:
                        return create_rating_data(
                            RATING_STATUS["TIMEOUT"],
                            results.get("status_reason") or "请求超时",
                        )
                    if st == RATING_STATUS["FETCH_FAILED"]:
                        return create_rating_data(
                            RATING_STATUS["FETCH_FAILED"],
                            results.get("status_reason") or "获取失败",
                        )
                    if st == RATING_STATUS["NO_FOUND"]:
                        print("豆瓣平台未收录此影视")
                        return create_rating_data(
                            RATING_STATUS["NO_FOUND"],
                            results.get("status_reason") or "平台未收录",
                        )

                if not isinstance(results, list) or len(results) == 0:
                    continue

                threshold = (
                    60 if variant.get("strategy") == "anthology_series" else 70
                )
                matched_rows = []
                for result in results:
                    await check_req()
                    result["search_variant_used"] = variant
                    match_score = await calculate_match_degree(
                        tmdb_info, result, "douban"
                    )
                    if match_score >= threshold:
                        matched_rows.append(result)

                if not matched_rows:
                    continue

                merged_results = matched_rows
                winning_variant = variant
                break

            if not merged_results and tmdb_info.get("imdb_id"):
                imdb_id = tmdb_info["imdb_id"]
                print(f"\n[豆瓣备用策略] 尝试使用IMDB ID搜索: {imdb_id}")
                await check_req()
                imdb_search_url = f"https://search.douban.com/movie/subject_search?search_text={imdb_id}"
                results = await handle_douban_search(page, imdb_search_url, fast_mode=fast_mode)
                if isinstance(results, dict) and "status" in results:
                    st = results["status"]
                    if st == RATING_STATUS["RATE_LIMIT"]:
                        return create_rating_data(
                            RATING_STATUS["RATE_LIMIT"],
                            results.get("status_reason") or "访问频率限制",
                        )
                    if st == RATING_STATUS["TIMEOUT"]:
                        return create_rating_data(
                            RATING_STATUS["TIMEOUT"],
                            results.get("status_reason") or "请求超时",
                        )
                    if st == RATING_STATUS["FETCH_FAILED"]:
                        return create_rating_data(
                            RATING_STATUS["FETCH_FAILED"],
                            results.get("status_reason") or "获取失败",
                        )
                    if st == RATING_STATUS["NO_FOUND"]:
                        pass
                elif isinstance(results, list) and len(results) > 0:
                    results[0]["match_score"] = 100
                    results[0]["search_variant_used"] = {
                        "title": imdb_id,
                        "strategy": "imdb_id",
                        "type": "fallback",
                    }
                    merged_results = results

            if not merged_results:
                print("\n所有豆瓣搜索变体都失败")
                return create_rating_data(
                    RATING_STATUS["NO_FOUND"], "所有搜索策略都未找到匹配"
                )

            search_results_list = merged_results
            if winning_variant:
                for r in search_results_list:
                    r.setdefault("search_variant_used", winning_variant)

            best_match = None
            highest_score = 0
            matched_results = []
            for result in search_results_list:
                if isinstance(result, str):
                    result = {"title": result}
                await check_req()
                score = await calculate_match_degree(tmdb_info, result, "douban")
                result["match_score"] = score
                if media_type == "tv" and len(tmdb_info.get("seasons", [])) > 1:
                    if score > 50:
                        matched_results.append(result)
                else:
                    if score > highest_score:
                        highest_score = score
                        best_match = result

            if (
                media_type == "tv"
                and len(tmdb_info.get("seasons", [])) > 1
                and matched_results
            ):
                matched_results.sort(
                    key=lambda x: x.get("match_score", 0), reverse=True
                )
                best_match = matched_results[0]
            elif not best_match:
                return create_empty_rating_data(
                    "douban", media_type, RATING_STATUS["NO_FOUND"]
                )

            detail_url = _normalize_douban_detail_url(best_match.get("url") or "")
            print(
                f"豆瓣找到最佳匹配: {best_match['title']} ({best_match.get('year', '')})"
            )
            print(f"豆瓣访问详情页: {detail_url}")

            await check_req()
            await page.goto(detail_url, wait_until="domcontentloaded", timeout=(5000 if fast_mode else 15000))
            if not fast_mode:
                await douban_human_wait("after_detail_dom")
                await douban_simulate_light_browsing(page)

            rl_detail = await check_rate_limit(page, "douban")
            if rl_detail:
                return create_rating_data(
                    RATING_STATUS["RATE_LIMIT"],
                    rl_detail.get("status_reason") or "访问频率限制",
                )

            if (
                media_type == "tv"
                and len(tmdb_info.get("seasons", [])) > 1
                and matched_results
            ):
                rating_data = await extract_douban_rating(
                    page,
                    media_type,
                    matched_results,
                    tmdb_info=tmdb_info,
                    request=request,
                    douban_cookie=douban_cookie,
                    fast_mode=fast_mode,
                )
            else:
                rating_data = await extract_douban_rating(
                    page, media_type, search_results_list, tmdb_info=tmdb_info, fast_mode=fast_mode
                )

            if request and await request.is_disconnected():
                return {"status": "cancelled"}

            if rating_data:
                if media_type == "movie":
                    status = check_movie_status(rating_data, "douban")
                else:
                    status = check_tv_status(rating_data, "douban")
                rating_data["status"] = status
                rating_data["url"] = detail_url
                try:
                    rating_data["_match_score"] = float(best_match.get("match_score") or 0)
                except Exception:
                    rating_data["_match_score"] = None
            else:
                rating_data = create_empty_rating_data(
                    "douban", media_type, RATING_STATUS["NO_RATING"]
                )

            return rating_data

        except RequestCancelledException:
            print("豆瓣抓取请求已取消")
            return {"status": "cancelled"}
        except Exception as e:
            print(f"豆瓣单次会话抓取失败: {e}")
            print(traceback.format_exc())
            return create_empty_rating_data(
                "douban", media_type, RATING_STATUS["FETCH_FAILED"]
            )
        finally:
            if context:
                try:
                    await context.close()
                except Exception:
                    pass

    sf_key = _douban_singleflight_key(media_type, tmdb_info, douban_cookie)

    async def run_exclusive():
        await wait_before_douban_playwright_async(douban_cookie)
        async with douban_playwright_session_semaphore:
            return await browser_pool.execute_in_browser(pipeline)

    return await _await_same_douban_fetch(sf_key, run_exclusive)

async def handle_douban_search(page, search_url, fast_mode: bool = False):
    """处理豆瓣搜索"""
    try:
        if not fast_mode:
            await douban_human_wait("before_search_nav")
        print(f"访问豆瓣搜索页面: {search_url}")
        await page.goto(search_url, wait_until='domcontentloaded', timeout=(4500 if fast_mode else 20000))
        
        if not fast_mode:
            try:
                await page.wait_for_load_state('networkidle', timeout=3000)
            except Exception:
                pass
        
        if not fast_mode:
            await douban_human_wait("after_search_dom")
            await douban_simulate_light_browsing(page)
            await douban_human_wait("before_parse_search")

        rate_limit = await check_rate_limit(page, "douban")
        if rate_limit:
            print("检测到豆瓣访问限制")
            return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "访问频率限制"} 
        
        try:
            selectors_to_try = [
                '.sc-bZQynM .item-root',
                '.item-root',
                'a[class*="title-text"]',
                '[class*="item-root"]',
                'a[href*="/subject/"]',
            ]

            results = await page.evaluate(
                """(args) => {
                    const selectors = args.selectors || [];
                    const maxItems = args.maxItems;
                    const selectorsList = Array.isArray(selectors) ? selectors : [];
                    let nodes = [];
                    for (const sel of selectorsList) {
                        const found = Array.from(document.querySelectorAll(sel || ''));
                        if (found.length) { nodes = found; break; }
                    }
                    if (!nodes.length) return [];

                    const out = [];
                    const max = Math.min(maxItems || 0, nodes.length);
                    const titleRe = /(.*?)\\s*\\((\\d{4})\\)/;

                    for (let i = 0; i < max; i++) {
                        const node = nodes[i];
                        try {
                            let titleElem = node.querySelector ? node.querySelector('.title-text') : null;
                            if (!titleElem && node.matches && node.matches('.title-text')) titleElem = node;
                            if (!titleElem) {
                                const a = node.querySelector ? node.querySelector('a[href]') : null;
                                titleElem = a || node;
                            }

                            const titleText = (titleElem && titleElem.textContent ? titleElem.textContent : (node.textContent || '')).trim();
                            const url = (titleElem && titleElem.getAttribute ? titleElem.getAttribute('href') : null) || (node.getAttribute ? node.getAttribute('href') : null) || '';

                            const m = titleText.match(titleRe);
                            if (m) {
                                out.push({ title: (m[1] || '').trim(), year: m[2] || '', url });
                            } else {
                                out.push({ title: titleText, year: '', url });
                            }
                        } catch (e) {}
                    }

                    return out;
                }""",
                {"selectors": selectors_to_try, "maxItems": MAX_MATCH_CANDIDATES_PER_PLATFORM},
            )

            if not results:
                raw = await page.content()
                if (
                    "你访问豆瓣的方式有点像机器人程序" in raw
                    or "点击证明" in raw
                ):
                    return {
                        "status": RATING_STATUS["RATE_LIMIT"],
                        "status_reason": "豆瓣人机验证：请在本地浏览器打开 douban.com 完成验证后，更新账号中的豆瓣 Cookie 再试",
                    }
                return {"status": RATING_STATUS["NO_FOUND"], "status_reason": "平台未收录"}

            return results if results else {"status": RATING_STATUS["NO_FOUND"]}

        except Exception as e:
            print(f"等待豆瓣搜索结果时出错: {e}")
            if "Timeout" in str(e):
                return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"}
            return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}
            
    except Exception as e:
        print(f"访问豆瓣搜索页面失败: {e}")
        if "Timeout" in str(e):
            return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"}
        return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}

async def handle_imdb_search(page, search_url):
    """处理IMDB搜索"""
    try:
        async def block_resources(route):
            resource_type = route.request.resource_type
            if resource_type in ["image", "stylesheet", "font", "media"]:
                await route.abort()
            else:
                await route.continue_()
        
        await page.route("**/*", block_resources)
        
        await random_delay()
        print(f"访问 IMDb 搜索页面: {search_url}")
        await page.goto(search_url, wait_until='domcontentloaded', timeout=10000)
        await asyncio.sleep(0.2)
    
        rate_limit = await check_rate_limit(page, "imdb")
        if rate_limit:
            print("检测到IMDb访问限制")
            return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "访问频率限制"} 
        
        try:
            items = await page.query_selector_all('.ipc-metadata-list-summary-item')
            results = []
            
            if not items:
                return {"status": RATING_STATUS["NO_FOUND"], "status_reason": "平台未收录"}
                    
            for item in items:
                try:
                    title_elem = await item.query_selector('a.ipc-metadata-list-summary-item__t')
                    
                    if title_elem:
                        title = await title_elem.inner_text()
                        url = await title_elem.get_attribute('href')
                        
                        year = None
                        
                        all_list_items = await item.query_selector_all('.ipc-inline-list__item')
                        for list_item in all_list_items:
                            text = await list_item.inner_text()
                            year_match = re.search(r'\b(19\d{2}|20\d{2})\b', text)
                            if year_match:
                                year = year_match.group(1)
                                break
                        
                        if not year:
                            year_match = re.search(r'\((\d{4})\)', title)
                            if year_match:
                                year = year_match.group(1)
                        
                        if not year:
                            type_elem = await item.query_selector('.ipc-inline-list__item .ipc-metadata-list-summary-item__li')
                            if type_elem:
                                year = await type_elem.inner_text()
                        
                        if url and "/title/" in url:
                            imdb_id = url.split("/title/")[1].split("/")[0]
                            results.append({
                                "title": title,
                                "year": year or "",
                                "imdb_id": imdb_id,
                                "url": f"https://www.imdb.com/title/{imdb_id}/"
                            })
                except Exception as e:
                    print(f"处理IMDb单个搜索结果时出错: {e}")
                    continue
        
            return results if results else {"status": RATING_STATUS["NO_FOUND"]}
        
        except Exception as e:
            print(f"等待IMDb搜索结果超时: {e}")
            if "Timeout" in str(e):
                return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"}
            return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}
            
    except Exception as e:
        print(f"访问IMDb搜索页面失败: {e}")
        if "Timeout" in str(e):
            return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"}
        return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}

async def handle_rt_search(page, search_url, tmdb_info):
    """处理Rotten Tomatoes搜索"""
    try:
        async def block_resources(route):
            resource_type = route.request.resource_type
            if resource_type in ["image", "stylesheet", "font", "media"]:
                await route.abort()
            else:
                await route.continue_()
        
        await page.route("**/*", block_resources)
        
        await random_delay()
        print(f"访问 Rotten Tomatoes 搜索页面: {search_url}")
        await page.goto(search_url, wait_until='domcontentloaded', timeout=10000)
        await asyncio.sleep(0.2)
    
        rate_limit = await check_rate_limit(page, "rottentomatoes")
        if rate_limit:
            print("检测到Rotten Tomatoes访问限制")
            return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "访问频率限制"} 
        
        try:
            media_type = tmdb_info.get('type', 'movie')
            result_type = 'movie' if media_type == 'movie' else 'tvSeries'
            
            try:
                filter_elements = await page.query_selector_all('span[data-qa="search-filter-text"]')
                
                for elem in filter_elements:
                    await elem.inner_text()
                
                if media_type == 'movie':
                    movies_tab = await page.wait_for_selector('span[data-qa="search-filter-text"]:has-text("Movies")', timeout=5000)
                    if movies_tab:
                        await movies_tab.click()
                else:
                    tv_tab = await page.wait_for_selector('span[data-qa="search-filter-text"]:has-text("TV Shows")', timeout=5000)
                    if tv_tab:
                        await tv_tab.click()
                
                await asyncio.sleep(1)
            
            except Exception as e:
                print(f"Rotten Tomatoes切换媒体类型标签失败: {str(e)}")
                print(f"Rotten Tomatoes错误类型: {type(e)}")
            
            result_section = f'search-page-result[type="{result_type}"]:not([hidden])'
            section = await page.wait_for_selector(result_section, timeout=5000)
            
            if not section:
                print(f"Rotten Tomatoes未找到{media_type}类型的搜索结果区域")
                return {"status": RATING_STATUS["NO_FOUND"], "status_reason": "平台未收录"}
            
            items = await page.evaluate(
                """(args) => {
                    const sectionSelector = args.sectionSelector;
                    const maxItems = args.maxItems;
                    const mediaType = args.mediaType;
                    const section = document.querySelector(sectionSelector);
                    if (!section) return [];
                    const rows = Array.from(section.querySelectorAll('search-page-media-row'));
                    const out = [];
                    const max = Math.min(maxItems || 0, rows.length);
                    const yearAttr = mediaType === 'movie' ? 'releaseyear' : 'startyear';
                    const urlNeedle = mediaType === 'movie' ? '/m/' : '/tv/';
                    for (let i = 0; i < max; i++) {
                        const row = rows[i];
                        const titleElem = row.querySelector('[data-qa="info-name"]');
                        if (!titleElem) continue;
                        const title = (titleElem.textContent || '').trim();
                        const url = titleElem.getAttribute('href') || '';
                        if (!url || !url.includes(urlNeedle)) continue;
                        const year = (row.getAttribute(yearAttr) || '') + '';
                        out.push({ title, year, url });
                    }
                    return out;
                }""",
                {"sectionSelector": result_section, "maxItems": MAX_MATCH_CANDIDATES_PER_PLATFORM, "mediaType": media_type},
            )
            results = []
            
            if not items:
                print(f"Rotten Tomatoes在{media_type}区域未找到任何结果")
                return {"status": RATING_STATUS["NO_FOUND"], "status_reason": "平台未收录"}
            
            print(f"Rotten Tomatoes找到 {len(items)} 个{media_type}类型结果")
            
            is_anthology = tmdb_info.get("is_anthology", False)
            search_variants = tmdb_info.get("search_variants", [])
            
            using_subtitle_search = False
            if is_anthology and search_variants:
                import urllib.parse
                search_query = urllib.parse.unquote(search_url.split("search=")[-1].split("&")[0] if "search=" in search_url else "").lower()
                
                for variant in search_variants:
                    if variant.get("for_rottentomatoes"):
                        variant_title = variant.get("title", "").lower()
                        if variant_title == search_query:
                            using_subtitle_search = True
                            print(f"Rotten Tomatoes[选集剧] 使用副标题搜索：{variant.get('title')}")
                            break
            
            if using_subtitle_search and items:
                try:
                    first = items[0]
                    title = first.get("title", "")
                    url = first.get("url", "")
                    year = first.get("year", "")
                    
                    print(f"Rotten Tomatoes选集剧第一个结果: {title} ({year})")
                    
                    return [{
                        "title": title,
                        "year": year or tmdb_info.get('year'),
                        "url": url,
                        "match_score": 100,
                        "is_anthology_match": True
                    }]
                except Exception as e:
                    print(f"Rotten Tomatoes获取选集剧第一个结果时出错: {e}")
            
            for item in items:
                try:
                    title = item.get("title", "")
                    url = item.get("url", "")
                    year = item.get("year", "")
                    
                    url_type_match = ('/m/' in url) if media_type == 'movie' else ('/tv/' in url)
                    if not url_type_match:
                        continue

                    original_title = tmdb_info.get("original_title", "")
                    en_title = tmdb_info.get("en_title", "")
                    
                    def is_english_text(text):
                        if not text:
                            return False
                        try:
                            ascii_count = sum(1 for c in text if ord(c) < 128)
                            return ascii_count / len(text) > 0.8
                        except:
                            return False
                    
                    if original_title and is_english_text(original_title):
                        match_title = original_title
                    elif en_title:
                        match_title = en_title
                    else:
                        match_title = tmdb_info.get("title", "")
                    
                    title_match = title.lower() == match_title.lower()
                    year_match = False
                    
                    match_year = tmdb_info['year']
                    if is_anthology:
                        series_info = tmdb_info.get("series_info", {})
                        if series_info:
                            main_series_year = series_info.get("main_series_year")
                            if main_series_year:
                                match_year = main_series_year
                                print(f"Rotten Tomatoes使用主系列年份进行匹配: {main_series_year}")
                    
                    if year:
                        year_match = year == match_year
                    else:
                        current_year = datetime.now(ZoneInfo("Asia/Shanghai")).year
                        target_year = int(match_year) if match_year else current_year
                        if target_year > current_year and title_match:
                            year_match = True
                    
                    if title_match and year_match:
                        return [{
                            "title": title,
                            "year": year or tmdb_info['year'],
                            "url": url,
                            "match_score": 100,
                            "number_of_seasons": tmdb_info.get("number_of_seasons", 0)
                        }]

                    result_data = {
                        "title": title,
                        "year": year or tmdb_info['year'],
                        "url": url,
                        "number_of_seasons": tmdb_info.get("number_of_seasons", 0)
                    }
                    
                    result_data["match_score"] = await calculate_match_degree(
                        tmdb_info, 
                        result_data,
                        platform="rottentomatoes"
                    )
                    
                    results.append(result_data)

                except Exception as e:
                    print(f"处理Rotten Tomatoes单个搜索结果时出错: {e}")
                    continue
        
            return results if results else {"status": RATING_STATUS["NO_FOUND"]}
        
        except Exception as e:
            print(f"等待Rotten Tomatoes搜索结果超时: {e}")
            if "Timeout" in str(e):
                return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"}
            return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}
            
    except Exception as e:
        print(f"访问Rotten Tomatoes搜索页面失败: {e}")
        if "Timeout" in str(e):
            return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"}
        return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}

async def handle_metacritic_search(page, search_url, tmdb_info=None):
    """处理Metacritic搜索"""
    try:
        async def block_resources(route):
            resource_type = route.request.resource_type
            if resource_type in ["image", "stylesheet", "font", "media"]:
                await route.abort()
            else:
                await route.continue_()
        
        await page.route("**/*", block_resources)
        
        await random_delay()
        print(f"访问 Metacritic 搜索页面: {search_url}")
        await page.goto(search_url, wait_until='domcontentloaded', timeout=10000)
        await asyncio.sleep(0.2)
    
        rate_limit = await check_rate_limit(page, "metacritic")
        if rate_limit:
            print("检测到Metacritic访问限制")
            return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "访问频率限制"} 
        
        try:
            try:
                await page.wait_for_selector(
                    '[data-testid="search-item"], [data-testid="search-result-item"]',
                    timeout=8000,
                )
            except Exception:
                pass

            is_anthology = tmdb_info.get("is_anthology", False) if tmdb_info else False
            series_info = tmdb_info.get("series_info", {}) if tmdb_info else {}
            fallback_year = str(tmdb_info.get("year")) if tmdb_info and tmdb_info.get("year") else ""
            if is_anthology and series_info:
                main_series_year = series_info.get("main_series_year")
                if main_series_year:
                    fallback_year = str(main_series_year)
                    print(f"Metacritic使用主系列年份进行匹配: {main_series_year}")

            results = await page.evaluate(
                """(args) => {
                    const maxItems = args.maxItems;
                    const fallbackYear = args.fallbackYear;
                    const nodes = Array.from(document.querySelectorAll('[data-testid="search-item"], [data-testid="search-result-item"]'));
                    const out = [];
                    const seen = new Set();
                    const max = Math.min(maxItems || 0, nodes.length);
                    const yearRe = /\\b(19\\d{2}|20\\d{2})\\b/;
                    for (let i = 0; i < max; i++) {
                        const item = nodes[i];
                        try {
                            const a = item.querySelector('a[href]');
                            const href = a ? a.getAttribute('href') : null;
                            if (!href) continue;
                            const fullUrl = href.startsWith('http') ? href : `https://www.metacritic.com${href}`;
                            if (seen.has(fullUrl)) continue;
                            seen.add(fullUrl);

                            const titleElem = item.querySelector('p.c-search-item__title, .c-search-item__title');
                            const yearElem = item.querySelector(
                                'li.c-search-product-meta__release-date span, ' +
                                'li.c-search-product-meta__list-item.c-search-product-meta__release-date span'
                            );
                            const title = (titleElem ? titleElem.textContent : '').trim();
                            let year = (yearElem ? yearElem.textContent : '').trim();

                            if (!year && fallbackYear) year = String(fallbackYear);
                            if (!year) {
                                const text = (item.innerText || '').trim();
                                const m = text.match(yearRe);
                                if (m) year = m[1];
                            }

                            if (title) out.push({ title, year, url: fullUrl });
                            if (out.length >= maxItems) break;
                        } catch (e) {
                            // 忽略单条解析失败
                        }
                    }
                    return out;
                }""",
                {"maxItems": MAX_MATCH_CANDIDATES_PER_PLATFORM, "fallbackYear": fallback_year},
            )

            if results:
                print(f"Metacritic找到 {len(results)} 个搜索结果:")
                for i, r in enumerate(results[:5], 1):
                    print(f"  {i}. {r['title']} ({r['year']})")
                return results
            print("Metacritic未找到任何搜索结果")
            return {"status": RATING_STATUS["NO_FOUND"]}
        
        except Exception as e:
            print(f"等待Metacritic搜索结果超时: {e}")
            if "Timeout" in str(e):
                return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"}
            return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}
            
    except Exception as e:
        print(f"访问Metacritic搜索页面失败: {e}")
        if "Timeout" in str(e):
            return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"}
        return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}

async def handle_letterboxd_search(page, search_url, tmdb_info):
    """处理Letterboxd搜索"""
    new_ctx = None
    letterboxd_fs = None
    try:
        async def block_resources(route):
            resource_type = route.request.resource_type
            if resource_type in ["image", "stylesheet", "font", "media"]:
                await route.abort()
            else:
                await route.continue_()
        
        await page.route("**/*", block_resources)
        
        await random_delay()
        letterboxd_cookie = os.environ.get("LETTERBOXD_COOKIE", "").strip()
        if letterboxd_cookie:
            cookies = _parse_letterboxd_cookie_string(letterboxd_cookie)
            if cookies:
                await page.context.add_cookies(cookies)
                print("Letterboxd: 已注入 .env 中的 LETTERBOXD_COOKIE")
        print(f"访问 Letterboxd 搜索页面: {search_url}")
        await page.goto(search_url, wait_until='domcontentloaded', timeout=10000)
        await asyncio.sleep(0.2)
    
        if await _is_cloudflare_challenge(page):
            print("Letterboxd: 检测到 Cloudflare 安全验证页，短暂等待后尝试自动通过…")
            await asyncio.sleep(0.2)
            fs_url = os.environ.get("FLARESOLVERR_URL", "").strip()
            if fs_url:
                if not fs_url.endswith("/v1"):
                    fs_url = fs_url.rstrip("/") + "/v1"
                try:
                    print("Letterboxd: 使用 FlareSolverr 尝试绕过 Cloudflare…")
                    cached = None
                    async with _letterboxd_flaresolverr_cache_lock:
                        if _letterboxd_flaresolverr_cache.get("expires_at", 0.0) > time.time():
                            cached = {
                                "cookies": _letterboxd_flaresolverr_cache.get("cookies"),
                                "userAgent": _letterboxd_flaresolverr_cache.get("userAgent"),
                            }

                    if cached and cached.get("cookies") and cached.get("userAgent"):
                        pw = cached["cookies"]
                        ua = cached["userAgent"]
                        browser = page.context.browser
                        new_ctx = await browser.new_context(
                            viewport={"width": 1280, "height": 720},
                            user_agent=ua,
                        )
                        await new_ctx.add_cookies(pw)
                        new_page = await new_ctx.new_page()
                        await new_page.route("**/*", block_resources)
                        await new_page.goto(search_url, wait_until="domcontentloaded", timeout=10000)
                        await asyncio.sleep(0.2)
                        if await _is_cloudflare_challenge(new_page):
                            await new_ctx.close()
                            new_ctx = None
                            print("Letterboxd: 使用缓存 cookie 后仍为验证页，返回 RateLimit")
                            return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "Cloudflare 安全验证拦截，请稍后重试"}
                        print("Letterboxd: 缓存 cookie 绕过 Cloudflare，继续解析")
                        page = new_page
                        letterboxd_fs = {"cookies": pw, "userAgent": ua}
                    else:
                        async with aiohttp.ClientSession() as session:
                            async with session.post(
                                fs_url,
                                json={"cmd": "request.get", "url": search_url, "maxTimeout": 120000},
                                timeout=aiohttp.ClientTimeout(total=135),
                            ) as resp:
                                data = await resp.json()

                        if data.get("status") == "ok" and data.get("solution"):
                            sol = data["solution"]
                            cookies = sol.get("cookies") or []
                            ua = sol.get("userAgent") or ""

                            if cookies and ua:
                                pw = [
                                    {
                                        "name": c.get("name"),
                                        "value": c.get("value"),
                                        "domain": c.get("domain", ".letterboxd.com"),
                                        "path": c.get("path", "/"),
                                    }
                                    for c in cookies
                                    if c.get("name") and c.get("value")
                                ]
                                if pw:
                                    async with _letterboxd_flaresolverr_cache_lock:
                                        _letterboxd_flaresolverr_cache["expires_at"] = time.time() + _LETTERBOXD_FLARESOVERR_CACHE_TTL_SEC
                                        _letterboxd_flaresolverr_cache["cookies"] = pw
                                        _letterboxd_flaresolverr_cache["userAgent"] = ua

                                    browser = page.context.browser
                                    new_ctx = await browser.new_context(
                                        viewport={"width": 1280, "height": 720},
                                        user_agent=ua,
                                    )
                                    await new_ctx.add_cookies(pw)
                                    new_page = await new_ctx.new_page()
                                    await new_page.route("**/*", block_resources)
                                    await new_page.goto(search_url, wait_until="domcontentloaded", timeout=10000)
                                    await asyncio.sleep(0.2)
                                    if await _is_cloudflare_challenge(new_page):
                                        await new_ctx.close()
                                        new_ctx = None
                                        print("Letterboxd: FlareSolverr 注入 cookie 后仍为验证页，返回 RateLimit")
                                        return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "Cloudflare 安全验证拦截，请稍后重试"}
                                    print("Letterboxd: FlareSolverr 成功绕过 Cloudflare，继续解析")
                                    page = new_page
                                    letterboxd_fs = {"cookies": pw, "userAgent": ua}
                            else:
                                return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "Cloudflare 安全验证拦截，请稍后重试"}
                        else:
                            msg = data.get("message") or data.get("error") or "unknown"
                            print(f"Letterboxd: FlareSolverr 返回异常: status={data.get('status')}, message={msg}")
                            return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "Cloudflare 安全验证拦截，请稍后重试"}
                except Exception as e:
                    print(f"Letterboxd: FlareSolverr 请求失败: {type(e).__name__}: {e}")
                    return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "Cloudflare 安全验证拦截，请稍后重试"}
            else:
                print("Letterboxd: 遭遇 Cloudflare 安全验证，返回 RateLimit（未配置 FLARESOLVERR_URL）")
                return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "Cloudflare 安全验证拦截，请稍后重试"}
    
        rate_limit = await check_rate_limit(page, "letterboxd")
        if rate_limit:
            print("检测到Letterboxd访问限制")
            return rate_limit
        
        try:
            try:
                await page.wait_for_selector('.results li', timeout=5000)
            except Exception as e:
                print(f"Letterboxd等待搜索结果超时: {e}")
            
            items = await page.query_selector_all('div[data-item-link]')

            items = items[:MAX_MATCH_CANDIDATES_PER_PLATFORM]
            
            if not items:
                if await _is_cloudflare_challenge(page):
                    print("Letterboxd: 等待超时且为 Cloudflare 验证页，返回 RateLimit（非平台未收录）")
                    return {"status": RATING_STATUS["RATE_LIMIT"], "status_reason": "Cloudflare 安全验证拦截，请稍后重试"}
                print("Letterboxd未找到搜索结果")
                return {"status": RATING_STATUS["NO_FOUND"], "status_reason": "平台未收录"}
            
            first_item = items[0]
            try:
                detail_path = None
                title = "Unknown"
                
                detail_path = await first_item.get_attribute('data-item-link')
                if detail_path:
                    title = await first_item.get_attribute('data-item-name') or title
                
                if not detail_path:
                    print("Letterboxd 无法提取详情页链接")
                    html_snippet = await first_item.inner_html()
                    print(f"HTML片段: {html_snippet[:500]}")
                    return {"status": RATING_STATUS["NO_FOUND"], "status_reason": "平台未收录"}
                
                detail_url = f"https://letterboxd.com{detail_path}" if not detail_path.startswith('http') else detail_path
                
                print(f"Letterboxd找到匹配结果: {title}")
                
                r = {"title": title, "year": tmdb_info.get("year", ""), "url": detail_url, "match_score": 100}
                if letterboxd_fs:
                    r["_flaresolverr"] = letterboxd_fs
                return [r]
                
            except Exception as e:
                print(f"处理Letterboxd搜索结果项时出错: {e}")
                import traceback
                print(traceback.format_exc())
                return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "解析失败"}
            
        except Exception as e:
            print(f"处理Letterboxd搜索结果时出错: {e}")
            if "Timeout" in str(e):
                return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"}
            return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}
            
    except Exception as e:
        print(f"访问Letterboxd搜索页面失败: {e}")
        if "Timeout" in str(e):
            return {"status": RATING_STATUS["TIMEOUT"], "status_reason": "请求超时"}
        return {"status": RATING_STATUS["FETCH_FAILED"], "status_reason": "获取失败"}
    finally:
        if new_ctx:
            try:
                await new_ctx.close()
            except Exception:
                pass
    
async def extract_rating_info(media_type, platform, tmdb_info, search_results, request=None, douban_cookie=None):
    """从各平台详情页中提取对应评分数据"""
    async def _extract_rating_with_retry():
        try:
            await random_delay()
            if request and await request.is_disconnected():
                print("请求已被取消,停止执行")
                return {"status": "cancelled"}

            if platform == "trakt":
                try:
                    series_info = tmdb_info.get("series_info")
                    
                    trakt_data = await anthology_handler.search_trakt(tmdb_info, series_info)
                    
                    if trakt_data:
                        print(f"Trakt评分获取成功")
                        
                        result = {
                            "rating": str(trakt_data.get("rating", "暂无")),
                            "votes": str(trakt_data.get("votes", "暂无")),
                            "distribution": trakt_data.get("distribution", {}),
                            "url": trakt_data.get("url", ""),
                            "status": RATING_STATUS["SUCCESSFUL"]
                        }
                        
                        if "seasons" in trakt_data and trakt_data["seasons"]:
                            result["seasons"] = trakt_data["seasons"]
                        
                        return result
                    else:
                        print("Trakt评分获取失败：未找到匹配")
                        return {
                            "rating": "暂无",
                            "votes": "暂无",
                            "distribution": {},
                            "url": "",
                            "status": RATING_STATUS["NO_FOUND"]
                        }
                except Exception as e:
                    print(f"Trakt评分获取失败: {e}")
                    import traceback
                    print(traceback.format_exc())
                    return {
                        "rating": "暂无",
                        "votes": "暂无",
                        "distribution": {},
                        "url": "",
                        "status": RATING_STATUS["FETCH_FAILED"],
                        "status_reason": str(e)
                    }

            if isinstance(search_results, dict) and "status" in search_results:
                status = search_results["status"]
                if status == "cancelled":
                    return search_results
                elif status == RATING_STATUS["RATE_LIMIT"]:
                    return create_rating_data(RATING_STATUS["RATE_LIMIT"], search_results.get("status_reason") or "频率限制")
                elif status == RATING_STATUS["TIMEOUT"]:
                    return create_rating_data(RATING_STATUS["TIMEOUT"], "获取超时")
                elif status == RATING_STATUS["FETCH_FAILED"]:
                    return create_rating_data(RATING_STATUS["FETCH_FAILED"], "获取失败")

            if request and await request.is_disconnected():
                print("请求已被取消,停止执行")
                return {"status": "cancelled"}

            if isinstance(search_results, list) and not search_results:
                print(f"\n{platform}平台未收录此影视")
                return create_rating_data(RATING_STATUS["NO_FOUND"])

            best_match = None
            highest_score = 0
            matched_results = []
            
            for result in search_results:
                if isinstance(result, str):
                    result = {"title": result}

                if request and await request.is_disconnected():
                    print("请求已被取消,停止执行")
                    return {"status": "cancelled"}

                if isinstance(result, dict) and "match_score" in result:
                    score = result.get("match_score") or 0
                else:
                    score = await calculate_match_degree(tmdb_info, result, platform)
                    if isinstance(result, dict):
                        result["match_score"] = score
                
                if media_type == "tv" and len(tmdb_info.get("seasons", [])) > 1:
                    if score > 50:
                        matched_results.append(result)
                else:
                    if score > highest_score:
                        highest_score = score
                        best_match = result

            if media_type == "tv" and len(tmdb_info.get("seasons", [])) > 1 and matched_results:
                matched_results.sort(key=lambda x: x.get("match_score", 0), reverse=True)
                print(f"{platform} 找到 {len(matched_results)} 个匹配的季")
                
                best_match = matched_results[0]
            elif not best_match:
                print(f"在{platform}平台未找到匹配的结果")
                return create_empty_rating_data(platform, media_type, RATING_STATUS["NO_FOUND"])

            detail_url = best_match["url"]
            if platform == "douban":
                detail_url = _normalize_douban_detail_url(detail_url)
            print(f"{platform} 找到最佳匹配结果: {best_match['title']} ({best_match.get('year', '')})")
            print(f"{platform} 访问详情页: {detail_url}")

            async def extract_with_browser(browser):
                context = None
                try:
                    fs_data = best_match.get("_flaresolverr") if platform == "letterboxd" else None
                    selected_user_agent = (fs_data.get("userAgent") or random.choice(USER_AGENTS)) if (platform == "letterboxd" and fs_data) else random.choice(USER_AGENTS)

                    if platform == "douban":
                        context_options = {
                            'viewport': {'width': 1280, 'height': 720},
                            'user_agent': selected_user_agent,
                            'bypass_csp': True,
                            'ignore_https_errors': True,
                            'java_script_enabled': True,
                            'has_touch': False,
                            'is_mobile': False,
                            'locale': 'zh-CN',
                            'timezone_id': 'Asia/Shanghai',
                            'extra_http_headers': {
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                                'Accept-Encoding': 'gzip, deflate, br',
                                'DNT': '1',
                                'Connection': 'keep-alive',
                                'Upgrade-Insecure-Requests': '1',
                                'Sec-Fetch-Dest': 'document',
                                'Sec-Fetch-Mode': 'navigate',
                                'Sec-Fetch-Site': 'none',
                                'Sec-Fetch-User': '?1'
                            }
                        }
                    else:
                        context_options = {
                            'viewport': {'width': 1280, 'height': 720},
                            'user_agent': selected_user_agent,
                            'bypass_csp': True,
                            'ignore_https_errors': True,
                            'java_script_enabled': True,
                            'has_touch': False,
                            'is_mobile': False,
                            'locale': 'en-US',
                            'timezone_id': 'America/New_York',
                            'extra_http_headers': {
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                                'Accept-Language': 'en-US,en;q=0.5',
                                'Accept-Encoding': 'gzip, deflate, br',
                                'DNT': '1',
                                'Connection': 'keep-alive',
                                'Upgrade-Insecure-Requests': '1',
                                'Sec-Fetch-Dest': 'document',
                                'Sec-Fetch-Mode': 'navigate',
                                'Sec-Fetch-Site': 'none',
                                'Sec-Fetch-User': '?1'
                            }
                        }

                    context = await browser.new_context(**context_options)
                    if platform == "douban":
                        await _apply_douban_light_blocking_routes(context)
                    page = await context.new_page()
                    page.set_default_timeout(30000)
                    if platform == "douban":
                        await _playwright_stealth_optional(page)

                    if platform == "douban":
                        headers = {}
                        if douban_cookie:
                            headers['Cookie'] = douban_cookie
                            print(f"✅ 豆瓣请求使用用户自定义Cookie（长度: {len(douban_cookie)}）")
                            douban_cookies = _parse_douban_cookie_string(douban_cookie)
                            if douban_cookies:
                                await context.add_cookies(douban_cookies)
                                print("豆瓣: 已注入用户 Cookie 到浏览器")
                        else:
                            print("⚠️ 未提供豆瓣Cookie，使用默认方式")
                        if headers:
                            await page.set_extra_http_headers(headers)

                    if request and await request.is_disconnected():
                        print("请求已被取消,停止执行")
                        return {"status": "cancelled"}

                    if platform == "imdb":
                        await page.goto(detail_url, wait_until="domcontentloaded", timeout=15000)
                        await asyncio.sleep(0.3)
                    elif platform == "douban":
                        await page.goto(detail_url, wait_until="domcontentloaded", timeout=15000)
                        await douban_human_wait("after_detail_dom")
                        await douban_simulate_light_browsing(page)
                        rl_d = await check_rate_limit(page, "douban")
                        if rl_d:
                            return create_rating_data(
                                RATING_STATUS["RATE_LIMIT"],
                                rl_d.get("status_reason") or "访问频率限制",
                            )
                    elif platform == "letterboxd":
                        letterboxd_cookie = os.environ.get("LETTERBOXD_COOKIE", "").strip()
                        if letterboxd_cookie:
                            cookies = _parse_letterboxd_cookie_string(letterboxd_cookie)
                            if cookies:
                                await context.add_cookies(cookies)
                        if fs_data and fs_data.get("cookies"):
                            await context.add_cookies(fs_data["cookies"])
                        await page.goto(detail_url, wait_until="domcontentloaded", timeout=15000)
                        await asyncio.sleep(0.3)
                        if await _is_cloudflare_challenge(page):
                            print("Letterboxd: 详情页触发 Cloudflare 安全验证，尝试用 FlareSolverr 拉取详情页…")
                            fs_url = os.environ.get("FLARESOLVERR_URL", "").strip()
                            if fs_url:
                                if not fs_url.endswith("/v1"):
                                    fs_url = fs_url.rstrip("/") + "/v1"
                                try:
                                    async with aiohttp.ClientSession() as session:
                                        async with session.post(
                                            fs_url,
                                            json={"cmd": "request.get", "url": detail_url, "maxTimeout": 120000},
                                            timeout=aiohttp.ClientTimeout(total=135),
                                        ) as resp:
                                            data = await resp.json()
                                    if data.get("status") == "ok" and data.get("solution"):
                                        sol = data["solution"]
                                        cookies = sol.get("cookies") or []
                                        ua = sol.get("userAgent") or ""
                                        if cookies and ua:
                                            pw = [{"name": c.get("name"), "value": c.get("value"), "domain": c.get("domain", ".letterboxd.com"), "path": c.get("path", "/")} for c in cookies if c.get("name") and c.get("value")]
                                            if pw:
                                                if context:
                                                    await context.close()
                                                opts = {**context_options, "user_agent": ua}
                                                context = await browser.new_context(**opts)
                                                page = await context.new_page()
                                                page.set_default_timeout(30000)
                                                await context.add_cookies(pw)
                                                await page.goto(detail_url, wait_until="domcontentloaded", timeout=15000)
                                                await asyncio.sleep(0.3)
                                                if await _is_cloudflare_challenge(page):
                                                    ret = create_empty_rating_data("letterboxd", media_type, RATING_STATUS["RATE_LIMIT"])
                                                    ret["status_reason"] = "详情页触发 Cloudflare 安全验证，请稍后重试"
                                                    return ret
                                            else:
                                                ret = create_empty_rating_data("letterboxd", media_type, RATING_STATUS["RATE_LIMIT"])
                                                ret["status_reason"] = "详情页触发 Cloudflare 安全验证，请稍后重试"
                                                return ret
                                        else:
                                            ret = create_empty_rating_data("letterboxd", media_type, RATING_STATUS["RATE_LIMIT"])
                                            ret["status_reason"] = "详情页触发 Cloudflare 安全验证，请稍后重试"
                                            return ret
                                    else:
                                        msg = data.get("message") or data.get("error") or "unknown"
                                        print(f"Letterboxd 详情页 FlareSolverr 返回异常: status={data.get('status')}, message={msg}")
                                        ret = create_empty_rating_data("letterboxd", media_type, RATING_STATUS["RATE_LIMIT"])
                                        ret["status_reason"] = "详情页触发 Cloudflare 安全验证，请稍后重试"
                                        return ret
                                except Exception as e:
                                    print(f"Letterboxd 详情页 FlareSolverr 请求失败: {type(e).__name__}: {e}")
                                    ret = create_empty_rating_data("letterboxd", media_type, RATING_STATUS["RATE_LIMIT"])
                                    ret["status_reason"] = "详情页触发 Cloudflare 安全验证，请稍后重试"
                                    return ret
                            else:
                                ret = create_empty_rating_data("letterboxd", media_type, RATING_STATUS["RATE_LIMIT"])
                                ret["status_reason"] = "详情页触发 Cloudflare 安全验证，请稍后重试"
                                return ret
                    elif platform == "rottentomatoes":
                        await page.goto(detail_url, wait_until="domcontentloaded", timeout=15000)
                        await asyncio.sleep(0.3)
                    elif platform == "metacritic":
                        await page.goto(detail_url, wait_until="domcontentloaded", timeout=15000)
                        await asyncio.sleep(0.3)
                    else:
                        await page.goto(detail_url, wait_until="domcontentloaded", timeout=15000)
                        await asyncio.sleep(0.3)

                    try:
                        if platform == "douban":
                            if media_type == "tv" and len(tmdb_info.get("seasons", [])) > 1 and matched_results:
                                print("检测到多季剧集，进行分季抓取以获取所有季评分")
                                rating_data = await extract_douban_rating(page, media_type, matched_results, tmdb_info=tmdb_info, request=request, douban_cookie=douban_cookie)
                            else:
                                rating_data = await extract_douban_rating(page, media_type, search_results, tmdb_info=tmdb_info)
                        elif platform == "imdb":
                            imdb_id = tmdb_info.get("imdb_id")
                            rating_data = None
                            
                            if imdb_id:
                                print(f"尝试使用IMDB GraphQL API获取评分 (ID: {imdb_id})")
                                rating_data = await get_imdb_rating_via_graphql(imdb_id)
                            
                            if not rating_data or rating_data.get("status") != RATING_STATUS["SUCCESSFUL"]:
                                if imdb_id:
                                    print("GraphQL API失败，fallback到网页抓取")
                                rating_data = await extract_imdb_rating(page)
                        elif platform == "letterboxd":
                            rating_data = await extract_letterboxd_rating(page)
                        elif platform == "rottentomatoes":
                            rating_data = await extract_rt_rating(page, media_type, tmdb_info)
                        elif platform == "metacritic":
                            rating_data = await extract_metacritic_rating(page, media_type, tmdb_info)

                        if request and await request.is_disconnected():
                            print("请求已被取消,停止执行")
                            return {"status": "cancelled"}

                        if rating_data:
                            if media_type == "movie":
                                status = check_movie_status(rating_data, platform)
                            else:
                                status = check_tv_status(rating_data, platform)

                            rating_data["status"] = status
                            rating_data["url"] = detail_url
                            try:
                                rating_data["_match_score"] = float(best_match.get("match_score") or 0)
                            except Exception:
                                rating_data["_match_score"] = None

                            if platform in ["rottentomatoes", "metacritic"]:
                                if "series" in rating_data:
                                    rating_data["series"]["status"] = status
                                if "seasons" in rating_data:
                                    for season in rating_data["seasons"]:
                                        season["status"] = status
                        else:
                            rating_data = create_empty_rating_data(platform, media_type, RATING_STATUS["NO_RATING"])

                    except Exception as e:
                        print(f"提取{platform}评分数据时出错: {e}")
                        print(traceback.format_exc())
                        rating_data = create_empty_rating_data(platform, media_type, RATING_STATUS["FETCH_FAILED"])

                    return rating_data

                finally:
                    if context:
                        try:
                            await context.close()
                        except Exception:
                            pass

            try:
                return await browser_pool.execute_in_browser(extract_with_browser)
            except Exception as e:
                print(f"访问{platform}详情页时出错: {e}")
                print(traceback.format_exc())
                return create_empty_rating_data(platform, media_type, RATING_STATUS["FETCH_FAILED"])

        except Exception as e:
            print(f"执行评分提取时出错: {e}")
            print(traceback.format_exc())
            return create_empty_rating_data(platform, media_type, RATING_STATUS["FETCH_FAILED"])

    return await _extract_rating_with_retry()

def build_direct_mapping_search_results(
    platform: str,
    tmdb_info: dict,
    url: str,
    extra: Optional[dict] = None,
) -> list[dict]:
    """把 mapping 的详情页 URL 转成 extract_rating_info 可用的搜索结果结构。"""
    item = {
        "title": tmdb_info.get("title") or tmdb_info.get("name") or "",
        "year": tmdb_info.get("year", ""),
        "url": url,
        "match_score": 100,
        "direct_match": True,
        "mapping_source": platform,
    }
    if extra:
        item.update(extra)
    return [item]

async def douban_extract_rating_from_season_urls(
    tmdb_info: dict,
    *,
    seasons_json: str,
    request=None,
    douban_cookie: Optional[str] = None,
) -> dict:
    """使用 mapping 中保存的豆瓣分季链接直接抓取（绕开搜索）。"""
    if (tmdb_info.get("type") or "").lower() != "tv":
        return create_empty_rating_data("douban", tmdb_info.get("type") or "tv", RATING_STATUS["FETCH_FAILED"])

    try:
        raw = json.loads(seasons_json or "{}")
    except Exception:
        raw = {}
    if not isinstance(raw, dict) or not raw:
        return create_empty_rating_data("douban", "tv", RATING_STATUS["NO_FOUND"])

    season_items: list[dict] = []
    for k, v in raw.items():
        try:
            sn = int(k)
        except Exception:
            continue
        url = str(v or "").strip()
        if not url:
            continue
        season_items.append({"title": f"Season {sn}", "url": url, "match_score": 100, "season_number": sn})
    season_items.sort(key=lambda x: int(x.get("season_number") or 0))
    if not season_items:
        return create_empty_rating_data("douban", "tv", RATING_STATUS["NO_FOUND"])

    async def pipeline(browser):
        context = None
        try:
            selected_user_agent = random.choice(USER_AGENTS)
            context_options = {
                "viewport": {"width": 1280, "height": 720},
                "user_agent": selected_user_agent,
                "bypass_csp": True,
                "ignore_https_errors": True,
                "java_script_enabled": True,
                "has_touch": False,
                "is_mobile": False,
                "locale": "zh-CN",
                "timezone_id": "Asia/Shanghai",
            }
            context = await browser.new_context(**context_options)
            await _apply_douban_light_blocking_routes(context)
            page = await context.new_page()
            page.set_default_timeout(30000)
            await _playwright_stealth_optional(page)

            first_url = str(season_items[0].get("url") or "").strip()
            warmup_title = str(
                tmdb_info.get("zh_title")
                or tmdb_info.get("title")
                or tmdb_info.get("name")
                or tmdb_info.get("original_title")
                or ""
            ).strip()
            warmup_search_url = (
                f"https://search.douban.com/movie/subject_search?search_text={quote(warmup_title)}"
                if warmup_title
                else ""
            )
            if request is not None or douban_cookie:
                headers = {}
                if douban_cookie:
                    headers["Cookie"] = douban_cookie
                    parsed = _parse_douban_cookie_string(douban_cookie)
                    if parsed:
                        await context.add_cookies(parsed)
                if headers:
                    await page.set_extra_http_headers(headers)

            if warmup_search_url:
                try:
                    await page.goto(warmup_search_url, wait_until="domcontentloaded", timeout=12000)
                    await asyncio.sleep(0.25)
                except Exception:
                    pass

            await page.goto(
                first_url,
                wait_until="domcontentloaded",
                timeout=15000,
                referer=(warmup_search_url or "https://search.douban.com/"),
            )
            await asyncio.sleep(0.1)

            rating_data = await extract_douban_rating(
                page,
                "tv",
                season_items,
                tmdb_info=tmdb_info,
                request=request,
                douban_cookie=douban_cookie,
                fast_mode=True,
            )

            if rating_data:
                status = check_tv_status(rating_data, "douban")
                rating_data["status"] = status
                rating_data["url"] = first_url
                rating_data["_match_score"] = 100.0
                return rating_data
            return create_empty_rating_data("douban", "tv", RATING_STATUS["FETCH_FAILED"])
        finally:
            if context:
                try:
                    await context.close()
                except Exception:
                    pass

    try:
        return await browser_pool.execute_in_browser(pipeline)
    except Exception:
        return create_empty_rating_data("douban", "tv", RATING_STATUS["FETCH_FAILED"])

def _rt_scores_from_score_data(score_data: dict) -> dict:
    overlay_data = (score_data or {}).get("overlay", {}) if isinstance(score_data, dict) else {}
    has_audience = bool(overlay_data.get("hasAudienceAll", False))
    has_critics = bool(overlay_data.get("hasCriticsAll", False))
    audience_data = overlay_data.get("audienceAll", {}) if isinstance(overlay_data.get("audienceAll"), dict) else {}
    critics_data = overlay_data.get("criticsAll", {}) if isinstance(overlay_data.get("criticsAll"), dict) else {}

    audience_score = "暂无"
    audience_avg = "暂无"
    audience_count = "暂无"
    if has_audience:
        v = audience_data.get("scorePercent")
        audience_score = v.rstrip("%") if isinstance(v, str) and v else (str(v).rstrip("%") if v is not None else "暂无")
        avg_rating = audience_data.get("averageRating")
        audience_avg = avg_rating if avg_rating and avg_rating not in ["暂无", ""] else "暂无"
        audience_count = audience_data.get("bandedRatingCount", "暂无")

    tomatometer = "暂无"
    critics_avg = "暂无"
    critics_count = "暂无"
    if has_critics:
        v = critics_data.get("scorePercent")
        tomatometer = v.rstrip("%") if isinstance(v, str) and v else (str(v).rstrip("%") if v is not None else "暂无")
        critics_avg = critics_data.get("averageRating", "暂无")
        slt = critics_data.get("scoreLinkText")
        critics_count = str(slt).split()[0] if slt else "暂无"

    return {
        "tomatometer": tomatometer,
        "audience_score": audience_score,
        "critics_avg": critics_avg,
        "critics_count": critics_count,
        "audience_count": audience_count,
        "audience_avg": audience_avg,
    }


def _douban_scores_has_rating(rating: object, rating_people: object) -> bool:
    invalid = {"", "暂无", "none", "n/a", "tbd"}
    return (
        str(rating if rating is not None else "").strip().lower() not in invalid
        and str(rating_people if rating_people is not None else "").strip().lower() not in invalid
    )

def _rt_scores_has_any_rating(scores: dict) -> bool:
    fields = ("tomatometer", "audience_score", "critics_avg", "critics_count", "audience_count", "audience_avg")
    return any(str((scores or {}).get(k, "")).strip().lower() not in ("", "暂无", "tbd") for k in fields)

def _metacritic_scores_has_any_rating(scores: dict) -> bool:
    fields = ("metascore", "critics_count", "userscore", "users_count")
    return any(str((scores or {}).get(k, "")).strip().lower() not in ("", "暂无", "tbd") for k in fields)

def _metacritic_tbd_flags(content: str) -> dict:
    raw = content or ""
    return {
        "critic_unavailable": bool(re.search(r'Critic reviews are not available yet|title="Metascore\s*TBD"|aria-label="Metascore\s*TBD"', raw, re.IGNORECASE)),
        "user_unavailable": bool(re.search(r'User reviews are not available yet|title="User score\s*TBD"|aria-label="User score\s*TBD"|Available after\s*\d+\s*ratings', raw, re.IGNORECASE)),
    }

def _letterboxd_scores_has_rating(rating: object, rating_count: object) -> bool:
    invalid = {"", "暂无", "none", "n/a", "tbd"}
    return (
        str(rating if rating is not None else "").strip().lower() not in invalid
        and str(rating_count if rating_count is not None else "").strip().lower() not in invalid
    )

async def rt_extract_rating_from_season_urls(
    tmdb_info: dict,
    *,
    seasons_json: str,
    series_url: Optional[str] = None,
    request=None,
    douban_cookie: Optional[str] = None,
) -> dict:
    """使用 mapping 中保存的 RottenTomatoes 分季链接直接抓取（绕开搜索）。"""
    if (tmdb_info.get("type") or "").lower() != "tv":
        return create_empty_rating_data("rottentomatoes", tmdb_info.get("type") or "tv", RATING_STATUS["FETCH_FAILED"])

    try:
        raw = json.loads(seasons_json or "{}")
    except Exception:
        raw = {}
    if not isinstance(raw, dict) or not raw:
        return create_empty_rating_data("rottentomatoes", "tv", RATING_STATUS["NO_FOUND"])

    season_urls: list[tuple[int, str]] = []
    for k, v in raw.items():
        try:
            sn = int(k)
        except Exception:
            continue
        url = str(v or "").strip()
        if not url:
            continue
        season_urls.append((sn, url))
    season_urls.sort(key=lambda x: x[0])
    if not season_urls:
        return create_empty_rating_data("rottentomatoes", "tv", RATING_STATUS["NO_FOUND"])

    async def pipeline(browser):
        context = None
        try:
            selected_user_agent = random.choice(USER_AGENTS)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 720},
                user_agent=selected_user_agent,
                bypass_csp=True,
                ignore_https_errors=True,
                java_script_enabled=True,
                locale="en-US",
                timezone_id="America/New_York",
            )
            page = await context.new_page()
            page.set_default_timeout(30000)

            seasons_out: list[dict] = []
            series_scores: Optional[dict] = None

            series_url_clean = str(series_url or "").strip()
            if series_url_clean:
                try:
                    await page.goto(series_url_clean, wait_until="domcontentloaded", timeout=15000)
                    await asyncio.sleep(0.15)
                    score_data = await get_rt_rating_fast(page)
                    if score_data:
                        series_scores = _rt_scores_from_score_data(score_data)
                except Exception:
                    pass

            for sn, url in season_urls:
                if request and await request.is_disconnected():
                    return {"status": "cancelled"}
                await page.goto(url, wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(0.2)
                score_data = await get_rt_rating_fast(page)
                if not score_data:
                    continue
                scores = _rt_scores_from_score_data(score_data)
                if series_scores is None:
                    series_scores = scores
                seasons_out.append(
                    {
                        "season_number": sn,
                        "url": url,
                        **scores,
                    }
                )

            if not series_scores and seasons_out:
                series_scores = {k: seasons_out[0].get(k) for k in ("tomatometer","audience_score","critics_avg","critics_count","audience_count","audience_avg")}

            if not series_scores:
                return create_empty_rating_data("rottentomatoes", "tv", RATING_STATUS["FETCH_FAILED"])

            has_any_rating = _rt_scores_has_any_rating(series_scores) or any(
                _rt_scores_has_any_rating(season_item) for season_item in seasons_out
            )
            status = RATING_STATUS["SUCCESSFUL"] if has_any_rating else RATING_STATUS["NO_RATING"]

            return {
                "series": series_scores,
                "seasons": seasons_out,
                "status": status,
                "url": series_url_clean or str(season_urls[0][1]),
                "_match_score": 100.0,
            }
        finally:
            if context:
                try:
                    await context.close()
                except Exception:
                    pass

    try:
        return await browser_pool.execute_in_browser(pipeline)
    except Exception:
        return create_empty_rating_data("rottentomatoes", "tv", RATING_STATUS["FETCH_FAILED"])

def _metacritic_overall_from_content(content: str) -> dict:
    def _extract_div_block_by_class(raw_html: str, class_name: str) -> str:
        raw = raw_html or ""
        open_div_pat = re.compile(r"<div\b[^>]*>", re.IGNORECASE)
        close_div_pat = re.compile(r"</div\s*>", re.IGNORECASE)
        class_pat = re.compile(rf'class\s*=\s*"[^"]*\b{re.escape(class_name)}\b[^"]*"', re.IGNORECASE)

        for m in open_div_pat.finditer(raw):
            tag = m.group(0)
            if not class_pat.search(tag):
                continue
            start = m.start()
            pos = m.end()
            depth = 1
            while depth > 0 and pos < len(raw):
                next_open = open_div_pat.search(raw, pos)
                next_close = close_div_pat.search(raw, pos)
                if not next_close:
                    break
                if next_open and next_open.start() < next_close.start():
                    depth += 1
                    pos = next_open.end()
                else:
                    depth -= 1
                    pos = next_close.end()
            if depth == 0:
                return raw[start:pos]
        return ""

    def _normalize_count(raw: str) -> str:
        s = str(raw or "").strip().replace(",", "").upper()
        if not s:
            return "暂无"
        try:
            if s.endswith("K"):
                return str(int(float(s[:-1]) * 1000))
            if s.endswith("M"):
                return str(int(float(s[:-1]) * 1000000))
            return str(int(float(s)))
        except Exception:
            m = re.search(r"([\d.]+)", s)
            if not m:
                return "暂无"
            try:
                return str(int(float(m.group(1))))
            except Exception:
                return "暂无"

    overall = {
        "metascore": "暂无",
        "critics_count": "暂无",
        "userscore": "暂无",
        "users_count": "暂无",
    }

    raw_all = content or ""
    hero_raw = _extract_div_block_by_class(raw_all, "hero-scores")
    raw = hero_raw or ""
    score_blocks: list[str] = []
    product_starts = [m.start() for m in re.finditer(r'data-testid="product-score"', raw, re.IGNORECASE)]
    for i, start in enumerate(product_starts):
        end = product_starts[i + 1] if i + 1 < len(product_starts) else len(raw)
        score_blocks.append(raw[start:end])
    for block in score_blocks:
        block_text = block or ""
        header_match = re.search(
            r'data-testid="global-score-header"[^>]*>\s*([^<]+)\s*<',
            block_text,
            re.IGNORECASE,
        )
        if not header_match:
            continue
        header = header_match.group(1).strip().lower()

        if "metascore" in header:
            if "Critic reviews are not available yet" not in block_text:
                m_score = re.search(r'title="Metascore\s*(\d+)\s*out of 100"', block_text, re.IGNORECASE)
                if m_score:
                    overall["metascore"] = m_score.group(1)
                m_count = re.search(r'Based on\s*([\d.,KkMm]+)\s*Critic Reviews?', block_text, re.IGNORECASE)
                if m_count:
                    overall["critics_count"] = _normalize_count(m_count.group(1))
        elif "user score" in header:
            if "User reviews are not available yet" not in block_text:
                u_score = re.search(r'title="User score\s*([\d.]+)\s*out of 10"', block_text, re.IGNORECASE)
                if u_score:
                    overall["userscore"] = u_score.group(1)
                u_count = re.search(r'Based on\s*([\d.,KkMm]+)\s*User Ratings?', block_text, re.IGNORECASE)
                if u_count:
                    overall["users_count"] = _normalize_count(u_count.group(1))

    if any(overall[k] != "暂无" for k in ("metascore", "critics_count", "userscore", "users_count")):
        return overall

    metascore_patterns = [
        r'title="Metascore\s*(\d+)\s*out of 100"',
        r'"metascore"\s*:\s*"?(\d+)"?',
    ]
    critics_count_patterns = [
        r'Based on\s*([\d.,KkMm]+)\s*Critic Reviews?',
        r'"reviewCount"\s*:\s*"?([\d.,KkMm]+)"?',
    ]
    userscore_patterns = [
        r'title="User score\s*([\d.]+)\s*out of 10"',
        r'title="User Score\s*([\d.]+)\s*out of 10"',
        r'"userscore"\s*:\s*"?([\d.]+)"?',
    ]
    users_count_patterns = [
        r'Based on\s*([\d.,KkMm]+)\s*User Ratings?',
        r'"userReviewCount"\s*:\s*"?([\d.,KkMm]+)"?',
    ]

    flags = _metacritic_tbd_flags(raw_all)
    critic_unavailable = flags["critic_unavailable"]
    user_unavailable = flags["user_unavailable"]

    try:
        for p in metascore_patterns:
            m = re.search(p, content or "", re.IGNORECASE)
            if m:
                overall["metascore"] = m.group(1)
                break
    except Exception:
        pass
    if not critic_unavailable:
        try:
            for p in critics_count_patterns:
                m = re.search(p, content or "", re.IGNORECASE)
                if m:
                    overall["critics_count"] = _normalize_count(m.group(1))
                    break
        except Exception:
            pass
    if not user_unavailable:
        try:
            for p in userscore_patterns:
                m = re.search(p, content or "", re.IGNORECASE)
                if m:
                    overall["userscore"] = m.group(1)
                    break
        except Exception:
            pass
        try:
            for p in users_count_patterns:
                m = re.search(p, content or "", re.IGNORECASE)
                if m:
                    overall["users_count"] = _normalize_count(m.group(1))
                    break
        except Exception:
            pass
    return overall

async def metacritic_extract_rating_from_season_urls(
    tmdb_info: dict,
    *,
    seasons_json: str,
    series_url: Optional[str] = None,
    request=None,
    douban_cookie: Optional[str] = None,
) -> dict:
    """使用 mapping 中保存的 Metacritic 分季链接直接抓取（绕开搜索）。"""
    if (tmdb_info.get("type") or "").lower() != "tv":
        return create_empty_rating_data("metacritic", tmdb_info.get("type") or "tv", RATING_STATUS["FETCH_FAILED"])

    try:
        raw = json.loads(seasons_json or "{}")
    except Exception:
        raw = {}
    if not isinstance(raw, dict) or not raw:
        return create_empty_rating_data("metacritic", "tv", RATING_STATUS["NO_FOUND"])

    season_urls: list[tuple[int, str]] = []
    for k, v in raw.items():
        try:
            sn = int(k)
        except Exception:
            continue
        url = str(v or "").strip()
        if not url:
            continue
        season_urls.append((sn, url))
    season_urls.sort(key=lambda x: x[0])
    if not season_urls:
        return create_empty_rating_data("metacritic", "tv", RATING_STATUS["NO_FOUND"])

    async def pipeline(browser):
        context = None
        try:
            selected_user_agent = random.choice(USER_AGENTS)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 720},
                user_agent=selected_user_agent,
                bypass_csp=True,
                ignore_https_errors=True,
                java_script_enabled=True,
                locale="en-US",
                timezone_id="America/New_York",
            )
            page = await context.new_page()
            page.set_default_timeout(30000)

            seasons_out: list[dict] = []
            overall_first: Optional[dict] = None

            series_url_clean = str(series_url or "").strip()
            if series_url_clean:
                try:
                    await page.goto(series_url_clean, wait_until="domcontentloaded", timeout=15000)
                    await asyncio.sleep(0.2)
                    content_series = await page.content()
                    json_rating_series = await get_metacritic_rating_via_json(page, content=content_series)
                    overall_series = _metacritic_overall_from_content(content_series)
                    flags_series = _metacritic_tbd_flags(content_series)
                    if json_rating_series:
                        if json_rating_series.get("metascore") and not flags_series["critic_unavailable"]:
                            overall_series["metascore"] = str(json_rating_series.get("metascore"))
                        if json_rating_series.get("critics_count") and not flags_series["critic_unavailable"]:
                            overall_series["critics_count"] = str(json_rating_series.get("critics_count"))
                    overall_first = overall_series
                except Exception:
                    pass

            for sn, url in season_urls:
                if request and await request.is_disconnected():
                    return {"status": "cancelled"}
                await page.goto(url, wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(0.3)
                content = await page.content()

                json_rating = await get_metacritic_rating_via_json(page, content=content)
                overall = _metacritic_overall_from_content(content)
                flags = _metacritic_tbd_flags(content)
                if json_rating:
                    if json_rating.get("metascore") and not flags["critic_unavailable"]:
                        overall["metascore"] = str(json_rating.get("metascore"))
                    if json_rating.get("critics_count") and not flags["critic_unavailable"]:
                        overall["critics_count"] = str(json_rating.get("critics_count"))

                if overall_first is None:
                    overall_first = overall

                seasons_out.append(
                    {
                        "season_number": sn,
                        "url": url,
                        "metascore": overall.get("metascore", "暂无"),
                        "critics_count": overall.get("critics_count", "暂无"),
                        "userscore": overall.get("userscore", "暂无"),
                        "users_count": overall.get("users_count", "暂无"),
                    }
                )

            if overall_first is None and seasons_out:
                overall_first = {
                    "metascore": seasons_out[0].get("metascore", "暂无"),
                    "critics_count": seasons_out[0].get("critics_count", "暂无"),
                    "userscore": seasons_out[0].get("userscore", "暂无"),
                    "users_count": seasons_out[0].get("users_count", "暂无"),
                }

            if overall_first is None:
                return create_empty_rating_data("metacritic", "tv", RATING_STATUS["FETCH_FAILED"])

            has_any_rating = _metacritic_scores_has_any_rating(overall_first) or any(
                _metacritic_scores_has_any_rating(season_item) for season_item in seasons_out
            )
            status = RATING_STATUS["SUCCESSFUL"] if has_any_rating else RATING_STATUS["NO_RATING"]

            return {
                "overall": overall_first,
                "seasons": seasons_out,
                "status": status,
                "url": series_url_clean or str(season_urls[0][1]),
                "_match_score": 100.0,
            }
        finally:
            if context:
                try:
                    await context.close()
                except Exception:
                    pass

    try:
        return await browser_pool.execute_in_browser(pipeline)
    except Exception:
        return create_empty_rating_data("metacritic", "tv", RATING_STATUS["FETCH_FAILED"])

async def extract_douban_rating(page, media_type, matched_results, tmdb_info=None, request=None, douban_cookie=None, fast_mode: bool = False):
    """从豆瓣详情页提取评分数据"""
    try:
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=(2500 if fast_mode else 8000))
        except Exception as e:
            print(f"豆瓣等待domcontentloaded超时或失败，继续尝试直接解析: {e}")
        try:
            await page.wait_for_selector(
                "strong.rating_num, span[property='v:votes'], [class*='rating_num']",
                timeout=(1200 if fast_mode else 6000),
            )
        except Exception:
            pass
        if not fast_mode:
            await douban_simulate_light_browsing(page)
            await douban_human_wait("before_rating_parse")
        content = None
        for attempt in range(1 if fast_mode else 2):
            try:
                content = await page.content()
                if content:
                    break
            except Exception as e:
                print(f"豆瓣获取页面内容失败，第{attempt+1}次重试: {e}")
                if not fast_mode:
                    await asyncio.sleep(random.uniform(0.4, 1.0))
        if not content:
            return create_empty_rating_data("douban", media_type, RATING_STATUS["TIMEOUT"])

        if (
            "你访问豆瓣的方式有点像机器人程序" in content
            or "点击证明" in content
        ):
            ret = create_empty_rating_data("douban", media_type, RATING_STATUS["RATE_LIMIT"])
            ret["status_reason"] = (
                "豆瓣人机验证：请在本地浏览器打开 douban.com 完成验证后，更新账号中的豆瓣 Cookie 再试"
            )
            return ret

        try:
            initial_page_url = str(getattr(page, "url", "") or "").rstrip("/")
        except Exception:
            initial_page_url = ""

        try:
            current_host = (urlparse(initial_page_url).hostname or "").lower()
        except Exception:
            current_host = ""
        if current_host.startswith("sec.douban.com") or "/b?r=" in (initial_page_url or ""):
            ret = create_empty_rating_data("douban", media_type, RATING_STATUS["RATE_LIMIT"])
            ret["status_reason"] = (
                "豆瓣安全验证拦截（sec.douban.com）：请在本地浏览器完成验证后重试，或稍后再试"
            )
            print(f"豆瓣详情页被安全验证重定向: {initial_page_url}")
            return ret
        
        json_match = re.search(r'"aggregateRating":\s*{\s*"@type":\s*"AggregateRating",\s*"ratingCount":\s*"([^"]+)",\s*"bestRating":\s*"([^"]+)",\s*"worstRating":\s*"([^"]+)",\s*"ratingValue":\s*"([^"]+)"', content)
        
        if json_match:
            rating_people = json_match.group(1)
            rating = json_match.group(4)
        else:
            rating_match = re.search(r'<strong[^>]*class="ll rating_num"[^>]*>([^<]*)</strong>', content)
            rating = rating_match.group(1).strip() if rating_match and rating_match.group(1).strip() else "暂无"
            people_match = re.search(r'<span[^>]*property="v:votes">(\d+)</span>', content)
            rating_people = people_match.group(1) if people_match else "暂无"
            if rating in [None, "暂无"] or rating_people in [None, "暂无"]:
                try:
                    rating = await page.evaluate('''() => {
                        const el = document.querySelector('strong.rating_num');
                        return el ? el.textContent.trim() : "暂无";
                    }''') or "暂无"
                    rating_people = await page.evaluate('''() => {
                        const el = document.querySelector('span[property="v:votes"]');
                        return el ? el.textContent.trim() : "暂无";
                    }''') or "暂无"
                except Exception:
                    pass
            if rating not in [None, "暂无"] and rating_people not in [None, "暂无"]:
                pass
            else:
                pass
            
        if media_type != "tv":
            if "暂无评分" in content or "尚未上映" in content:
                return create_empty_rating_data("douban", media_type, RATING_STATUS["NO_RATING"])
            
            if rating in [None, "暂无"] or rating_people in [None, "暂无"]:
                return create_empty_rating_data("douban", media_type, RATING_STATUS["FETCH_FAILED"])
                
            return {
                "status": RATING_STATUS["SUCCESSFUL"],
                "rating": rating,
                "rating_people": rating_people,
                "url": initial_page_url,
            }
            
        season_results = []
        for result in matched_results:
            title = result.get("title", "")
            season_match = re.search(r'第([一二三四五六七八九十百]+)季|Season\s*(\d+)', title, re.IGNORECASE)
            if season_match:
                chinese_season = season_match.group(1) if season_match.group(1) else None
                arabic_season = season_match.group(2) if len(season_match.groups()) > 1 else None
                
                season_number = chinese_to_arabic(chinese_season) if chinese_season else int(arabic_season) if arabic_season else None
                
                if season_number:
                    season_results.append({
                        "season_number": season_number,
                        "title": title,
                        "url": result.get("url")
                    })

        total_seasons = 0
        try:
            total_seasons = int((tmdb_info or {}).get("number_of_seasons") or 0)
        except Exception:
            total_seasons = 0
        is_single_season_tv = media_type == "tv" and total_seasons == 1

        if is_single_season_tv and not season_results and initial_page_url:
            season_results.append({
                "season_number": 1,
                "title": "Season 1",
                "url": initial_page_url
            })
            print("豆瓣分季兜底: 单季剧未解析到季标题，补充第1季链接")
        
        season_results.sort(key=lambda x: x["season_number"])
        print(f"豆瓣分季: 共获取到 {len(season_results)} 个分季详情页链接")
        for sr in season_results:
            print(f"  第{sr['season_number']}季: url={sr.get('url') or '(空)'}")
        
        if not season_results:
            if "暂无评分" in content or "尚未上映" in content:
                return create_empty_rating_data("douban", media_type, RATING_STATUS["NO_RATING"])
            
            if rating in [None, "暂无"] or rating_people in [None, "暂无"]:
                return create_empty_rating_data("douban", media_type, RATING_STATUS["FETCH_FAILED"])
                
            return {
                "status": RATING_STATUS["SUCCESSFUL"],
                "rating": rating,
                "rating_people": rating_people,
                "url": initial_page_url,
            }
        
        first_season_url = season_results[0].get("url") if season_results else None
        ratings = {
            "status": RATING_STATUS["SUCCESSFUL"],
            "seasons": [],
            "url": first_season_url or initial_page_url,
        }
        
        all_seasons_no_rating = True
        processed_seasons = set()
        
        for season_info in season_results:
            try:
                season_number = season_info["season_number"]
                
                if season_number in processed_seasons:
                    continue
                    
                processed_seasons.add(season_number)
                
                url = season_info.get("url") or ""
                if not url:
                    ratings["seasons"].append({
                        "season_number": season_number,
                        "rating": "暂无",
                        "rating_people": "暂无",
                        "url": ""
                    })
                    continue

                url_norm = url.rstrip("/") if url else ""
                if is_single_season_tv and season_number == 1:
                    season_rating = str(rating).strip() if rating not in [None, "暂无"] else "暂无"
                    season_rating_people = str(rating_people).strip() if rating_people not in [None, "暂无"] else "暂无"
                    if season_rating in ["暂无", "", None] or season_rating_people in ["暂无", "", None]:
                        json_match_current = re.search(
                            r'"aggregateRating":\s*{\s*"@type":\s*"AggregateRating",\s*"ratingCount":\s*"([^"]+)",\s*"bestRating":\s*"([^"]+)",\s*"worstRating":\s*"([^"]+)",\s*"ratingValue":\s*"([^"]+)"',
                            content or ""
                        )
                        if json_match_current:
                            season_rating_people = json_match_current.group(1)
                            season_rating = json_match_current.group(4)
                        else:
                            rating_match_current = re.search(
                                r'<strong[^>]*class="ll rating_num"[^>]*>([^<]*)</strong>',
                                content or ""
                            )
                            people_match_current = re.search(
                                r'<span[^>]*property="v:votes">(\d+)</span>',
                                content or ""
                            )
                            if rating_match_current and rating_match_current.group(1).strip():
                                season_rating = rating_match_current.group(1).strip()
                            if people_match_current:
                                season_rating_people = people_match_current.group(1)
                    if season_rating not in ["暂无", "", None] and season_rating_people not in ["暂无", "", None]:
                        all_seasons_no_rating = False
                    ratings["seasons"].append({
                        "season_number": 1,
                        "rating": str(season_rating).strip() if season_rating not in [None, ""] else "暂无",
                        "rating_people": str(season_rating_people).strip() if season_rating_people not in [None, ""] else "暂无",
                        "url": initial_page_url or url
                    })
                    print("豆瓣第1季: 单季剧直接复用当前详情页解析，不再二次访问")
                    continue

                if not fast_mode:
                    await random_delay()
                    season_delay = random.uniform(3, 6)
                    print(f"豆瓣第{season_number}季: 等待 {season_delay:.1f} 秒后访问")
                    await asyncio.sleep(season_delay)
                if request is not None or douban_cookie:
                    headers = {}
                    if douban_cookie:
                        headers["Cookie"] = douban_cookie
                        print(f"✅ 豆瓣请求使用用户自定义Cookie（长度: {len(douban_cookie)}）")
                    if headers:
                        await page.set_extra_http_headers(headers)
                print(f"豆瓣第{season_number}季: 正在访问分季详情页 {url}")
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=(4000 if fast_mode else 15000))
                    if not fast_mode:
                        await asyncio.sleep(0.5)
                    try:
                        current_url = (page.url or "").rstrip("/")
                        if current_url and url_norm and current_url != url_norm:
                            print(f"豆瓣第{season_number}季: 访问后发生重定向，期望={url_norm}, 当前页={current_url}")
                    except Exception:
                        pass
                    try:
                        await page.wait_for_selector(
                            "strong.rating_num, span[property='v:votes']",
                            timeout=(1200 if fast_mode else 8000),
                        )
                    except Exception:
                        pass
                except Exception as e:
                    print(f"豆瓣访问第{season_number}季页面失败（可能超时或网络/访问限制）: {e}")
                    ratings["seasons"].append({
                        "season_number": season_number,
                        "rating": "暂无",
                        "rating_people": "暂无",
                        "url": url
                    })
                    continue
                
                try:
                    season_content = await page.content()
                except Exception as e:
                    print(f"豆瓣获取第{season_number}季页面内容失败: {e}")
                    ratings["seasons"].append({
                        "season_number": season_number,
                        "rating": "暂无",
                        "rating_people": "暂无",
                        "url": url
                    })
                    continue
                content_len = len(season_content) if season_content else 0
                has_aggregate = '"aggregateRating"' in (season_content or "")
                has_restriction = bool(season_content and (
                    "登录跳转" in season_content or "安全验证" in season_content or "机器人程序" in season_content
                    or "验证码" in season_content or "robot" in season_content.lower() or "unusual traffic" in (season_content or "").lower()
                ))
                print(f"豆瓣第{season_number}季: 页面长度={content_len}, 含aggregateRating={has_aggregate}, 疑似访问限制={has_restriction}")
                if has_restriction:
                    print(f"豆瓣第{season_number}季: 检测到可能访问限制，页面可能为登录/验证页")
                
                season_rating = "暂无"
                season_rating_people = "暂无"
                for attempt in range(1 if fast_mode else 3):
                    try:
                        json_match = re.search(r'"aggregateRating":\s*{\s*"@type":\s*"AggregateRating",\s*"ratingCount":\s*"([^"]+)",\s*"bestRating":\s*"([^"]+)",\s*"worstRating":\s*"([^"]+)",\s*"ratingValue":\s*"([^"]+)"', season_content)
                        
                        if json_match:
                            season_rating_people = json_match.group(1)
                            season_rating = json_match.group(4)
                            print(f"豆瓣提取到第{season_number}季评分成功")
                        else:
                            season_rating = await page.evaluate('''() => {
                                const ratingElement = document.querySelector('strong.rating_num');
                                return ratingElement ? ratingElement.textContent.trim() : "暂无";
                            }''')
                            
                            season_rating_people = await page.evaluate('''() => {
                                const votesElement = document.querySelector('span[property="v:votes"]');
                                return votesElement ? votesElement.textContent.trim() : "暂无";
                            }''')
                            
                            if season_rating in ["暂无", "", None]:
                                rating_match = re.search(r'<strong[^>]*class="ll rating_num"[^>]*>([^<]*)</strong>', season_content)
                                if rating_match and rating_match.group(1).strip():
                                    season_rating = rating_match.group(1).strip()
                                
                            if season_rating_people in ["暂无", "", None]:
                                people_match = re.search(r'<span[^>]*property="v:votes">(\d+)</span>', season_content)
                                if people_match:
                                    season_rating_people = people_match.group(1)
                            
                            if season_rating not in ["暂无", "", None] and season_rating_people not in ["暂无", "", None]:
                                print(f"豆瓣使用备选方法提取第{season_number}季评分成功")
                        
                        if season_rating not in ["暂无", "", None] and season_rating_people not in ["暂无", "", None]:
                            break
                            
                    except Exception as e:
                        print(f"豆瓣第{attempt + 1}次尝试获取第{season_number}季评分失败: {e}")
                        if not fast_mode and attempt < 2:
                            await random_delay()
                            await page.reload()
                            await page.wait_for_load_state("networkidle", timeout=5000)
                            season_content = await page.content()
                            continue
                
                if season_rating in ["暂无", "", None] or season_rating_people in ["暂无", "", None]:
                    json_match = re.search(r'"aggregateRating":\s*{\s*"@type":\s*"AggregateRating",\s*"ratingCount":\s*"([^"]+)",\s*"bestRating":\s*"([^"]+)",\s*"worstRating":\s*"([^"]+)",\s*"ratingValue":\s*"([^"]+)"', season_content)
                    if json_match:
                        season_rating_people = json_match.group(1)
                        season_rating = json_match.group(4)
                        print(f"豆瓣从页面 JSON 提取到第{season_number}季评分成功")
                    else:
                        rating_match = re.search(r'<strong[^>]*class="ll rating_num"[^>]*>([^<]*)</strong>', season_content)
                        if rating_match and rating_match.group(1).strip():
                            season_rating = rating_match.group(1).strip()
                        people_match = re.search(r'<span[^>]*property="v:votes">(\d+)</span>', season_content)
                        if people_match:
                            season_rating_people = people_match.group(1)
                        if season_rating not in ["暂无", "", None] and season_rating_people not in ["暂无", "", None]:
                            print(f"豆瓣从页面 HTML 提取到第{season_number}季评分成功")
                matched_rating = season_rating not in ["暂无", "", None] and season_rating_people not in ["暂无", "", None]
                print(f"豆瓣第{season_number}季: 匹配到评分元素={matched_rating}, rating={season_rating}, rating_people={season_rating_people}")
                
                if "暂无评分" in season_content or "尚未上映" in season_content:
                    ratings["seasons"].append({
                        "season_number": season_number,
                        "rating": "暂无",
                        "rating_people": "暂无",
                        "url": url
                    })
                elif season_rating not in ["暂无", "", None] and season_rating_people not in ["暂无", "", None]:
                    all_seasons_no_rating = False
                    ratings["seasons"].append({
                        "season_number": season_number,
                        "rating": str(season_rating).strip(),
                        "rating_people": str(season_rating_people).strip(),
                        "url": url
                    })
                else:
                    ratings["seasons"].append({
                        "season_number": season_number,
                        "rating": "暂无",
                        "rating_people": "暂无",
                        "url": url
                    })
                
            except Exception as e:
                print(f"豆瓣获取第{season_number}季评分时出错: {e}")
                if "Timeout" in str(e):
                    print(f"豆瓣第{season_number}季访问超时，跳过此季")
                ratings["seasons"].append({
                    "season_number": season_number,
                    "rating": "暂无",
                    "rating_people": "暂无",
                    "url": season_info.get("url", "")
                })
        
        for season_info in season_results:
            sn = season_info.get("season_number")
            if sn is None:
                continue
            if not any(s.get("season_number") == sn for s in ratings["seasons"]):
                ratings["seasons"].append({
                    "season_number": sn,
                    "rating": "暂无",
                    "rating_people": "暂无",
                    "url": season_info.get("url", "")
                })
        ratings["seasons"].sort(key=lambda s: s.get("season_number", 0))
        
        if not ratings["seasons"] and rating not in [None, "暂无"] and rating_people not in [None, "暂无"]:
            return {
                "status": RATING_STATUS["SUCCESSFUL"],
                "rating": rating,
                "rating_people": rating_people,
                "seasons": []
            }
        
        if all_seasons_no_rating and ratings["seasons"]:
            if rating not in [None, "暂无"] and rating_people not in [None, "暂无"]:
                ratings["rating"] = rating
                ratings["rating_people"] = rating_people
                ratings["status"] = RATING_STATUS["SUCCESSFUL"]
            else:
                ratings["status"] = RATING_STATUS["NO_RATING"]
        elif not ratings["seasons"]:
            ratings["status"] = RATING_STATUS["FETCH_FAILED"]
        else:
            first_valid = next(
                (s for s in ratings["seasons"] if s.get("rating") not in [None, "暂无"] and s.get("rating_people") not in [None, "暂无"]),
                None
            )
            if first_valid:
                ratings["rating"] = first_valid.get("rating")
                ratings["rating_people"] = first_valid.get("rating_people")
        valid_count = sum(1 for s in ratings.get("seasons", []) if s.get("rating") not in [None, "暂无"] and s.get("rating_people") not in [None, "暂无"])
        has_any_rating = _douban_scores_has_rating(ratings.get("rating"), ratings.get("rating_people")) or any(
            _douban_scores_has_rating(s.get("rating"), s.get("rating_people")) for s in ratings.get("seasons", [])
        )
        if not has_any_rating:
            ratings["status"] = RATING_STATUS["NO_RATING"]
        print(f"豆瓣多季返回: status={ratings.get('status')}, 共{len(ratings.get('seasons', []))}季其中{valid_count}季有有效评分")
        return ratings

    except Exception as e:
        print(f"提取豆瓣评分数据时出错: {e}")
        return create_empty_rating_data("douban", media_type, RATING_STATUS["FETCH_FAILED"])

async def get_imdb_rating_via_graphql(imdb_id: str) -> dict:
    """使用IMDB GraphQL API获取评分"""
    try:
        import aiohttp
        
        url = "https://caching.graphql.imdb.com/"
        
        query = """
        query GetRating($id: ID!) {
            title(id: $id) {
                id
                titleText {
                    text
                }
                ratingsSummary {
                    aggregateRating
                    voteCount
                }
                releaseYear {
                    year
                }
            }
        }
        """
        
        payload = {
            "query": query,
            "variables": {"id": imdb_id}
        }
        
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": "https://www.imdb.com",
            "Referer": "https://www.imdb.com/",
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers, timeout=10) as response:
                if response.status == 200:
                    data = await response.json()
                    
                    if data.get("data") and data["data"].get("title"):
                        title_data = data["data"]["title"]
                        ratings = title_data.get("ratingsSummary", {})
                        
                        rating = ratings.get("aggregateRating")
                        vote_count = ratings.get("voteCount")
                        
                        if rating is not None and vote_count is not None:
                            print(f"IMDb GraphQL API评分获取成功")
                            return {
                                "rating": str(rating),
                                "rating_people": str(vote_count),
                                "status": RATING_STATUS["SUCCESSFUL"]
                            }
                    
                    print("IMDb GraphQL API返回数据但无评分")
                    return None
                else:
                    print(f"IMDb GraphQL API请求失败: {response.status}")
                    return None
                    
    except Exception as e:
        print(f"IMDb GraphQL API调用失败: {e}")
        return None

async def extract_imdb_rating(page):
    """从IMDB详情页提取评分数据"""
    try:
        max_attempts = 2
        
        for attempt in range(max_attempts):
            try:
                if attempt == 0:
                    print(f"IMDb快速尝试提取评分...")
                else:
                    print(f"IMDb等待后重试提取评分...")
                    try:
                        await page.wait_for_selector('script[id="__NEXT_DATA__"]', timeout=5000)
                    except Exception as e:
                        print(f"IMDb等待__NEXT_DATA__脚本超时: {e}")
                
                content = await page.content()
                
                json_match = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>\s*({[^<]+})\s*</script>', content)
                
                if json_match:
                    break
                elif attempt < max_attempts - 1:
                    print("IMDb未找到__NEXT_DATA__，等待后重试...")
                    await asyncio.sleep(1)
                    continue
                else:
                    print("未找到IMDB的__NEXT_DATA__脚本")
                    return {
                        "rating": "暂无",
                        "rating_people": "暂无",
                        "status": RATING_STATUS["NO_RATING"]
                    }
                    
            except Exception as e:
                if attempt < max_attempts - 1:
                    print(f"IMDb第{attempt + 1}次提取失败: {e}，重试中...")
                    await asyncio.sleep(1)
                    continue
                raise
            
        try:
            json_data = json.loads(json_match.group(1))
            
            page_props = json_data.get("props", {}).get("pageProps", {})
            above_the_fold = page_props.get("aboveTheFoldData", {})
            ratings_summary = above_the_fold.get("ratingsSummary", {})
            
            aggregate_rating = ratings_summary.get("aggregateRating")
            vote_count = ratings_summary.get("voteCount")
            
            if aggregate_rating is None:
                print("IMDb中未找到评分数据")
                return {
                    "rating": "暂无",
                    "rating_people": "暂无",
                    "status": RATING_STATUS["NO_RATING"]
                }
            
            rating_text = str(aggregate_rating) if aggregate_rating else "暂无"
            rating_people_text = str(vote_count) if vote_count else "暂无"
            
            print(f"IMDb评分获取成功")
            
            return {
                "rating": rating_text,
                "rating_people": rating_people_text
            }
            
        except json.JSONDecodeError as e:
            print(f"解析IMDB JSON数据时出错: {e}")
            return {
                "rating": "暂无",
                "rating_people": "暂无",
                "status": "Fail"
            }

    except Exception as e:
        print(f"提取IMDB评分数据时出错: {e}")
        return {
            "rating": "暂无",
            "rating_people": "暂无",
            "status": "Fail"
        }
        
async def get_rt_rating_fast(page) -> dict:
    """从Rotten Tomatoes页面的JSON数据中提取评分"""
    try:
        try:
            json_data = await page.evaluate("""
                () => {
                    const script = document.getElementById('media-scorecard-json');
                    return script ? JSON.parse(script.textContent) : null;
                }
            """)
            
            if json_data:
                return json_data
        except Exception as e:
            print(f"Rotten Tomatoes JavaScript提取失败: {e}")
        
        content = await page.content()
        json_match = re.search(r'<script[^>]*id="media-scorecard-json"[^>]*>\s*({[^<]+})\s*</script>', content)
        if json_match:
            import json
            return json.loads(json_match.group(1))
        
        return None
        
    except Exception as e:
        print(f"Rotten Tomatoes快速提取JSON失败: {e}")
        return None

async def extract_rt_rating(page, media_type, tmdb_info):
    """从Rotten Tomatoes详情页提取评分数据"""
    try:
        score_data = await get_rt_rating_fast(page)
        
        if not score_data:
            return create_empty_rating_data("rottentomatoes", media_type, RATING_STATUS["NO_RATING"])
            
        overlay_data = score_data.get("overlay", {})
        
        has_audience = overlay_data.get("hasAudienceAll", False)
        has_critics = overlay_data.get("hasCriticsAll", False)
        
        if not has_audience and not has_critics:
            return create_empty_rating_data("rottentomatoes", media_type, RATING_STATUS["NO_RATING"])
        
        audience_data = overlay_data.get("audienceAll", {})
        critics_data = overlay_data.get("criticsAll", {})
        
        audience_score = "暂无"
        audience_avg = "暂无"
        audience_count = "暂无"
        if has_audience:
            audience_score = audience_data.get("scorePercent", "暂无").rstrip("%") if audience_data.get("scorePercent") else "暂无"
            avg_rating = audience_data.get("averageRating")
            audience_avg = avg_rating if avg_rating and avg_rating not in ["暂无", ""] else "暂无"
            audience_count = audience_data.get("bandedRatingCount", "暂无")
        
        tomatometer = "暂无"
        critics_avg = "暂无"
        critics_count = "暂无"
        if has_critics:
            tomatometer = critics_data.get("scorePercent", "暂无").rstrip("%") if critics_data.get("scorePercent") else "暂无"
            critics_avg = critics_data.get("averageRating", "暂无")
            critics_count = critics_data.get("scoreLinkText", "暂无").split()[0] if critics_data.get("scoreLinkText") else "暂无"
        
        ratings = {
            "series": {
                "tomatometer": tomatometer,
                "audience_score": audience_score,
                "critics_avg": critics_avg,
                "critics_count": critics_count,
                "audience_count": audience_count,
                "audience_avg": audience_avg
            },
            "seasons": [],
            "status": RATING_STATUS["SUCCESSFUL"]
        }
        
        if media_type == "tv":
            content = await page.content()
            if tmdb_info.get("is_anthology"):
                print(f"\n[选集剧]Rotten Tomatoes分季处理")
                tmdb_year = tmdb_info.get("year", "")
                
                season_tiles = re.findall(
                    r'<tile-season[^>]*href="([^"]+)"[^>]*>.*?'
                    r'<rt-text[^>]*slot="title"[^>]*>([^<]+)</rt-text>.*?'
                    r'<rt-text[^>]*slot="airDate"[^>]*>([^<]+)</rt-text>',
                    content,
                    re.DOTALL | re.IGNORECASE
                )
                
                print(f"Rotten Tomatoes解析到 {len(season_tiles)} 个季")
                
                matched_season = None
                for season_url, season_title, season_date in season_tiles:
                    year_match = re.search(r'(\d{4})', season_date)
                    if year_match:
                        season_year = year_match.group(1)
                        if season_year == tmdb_year:
                            season_num_match = re.search(r'/s(\d+)', season_url)
                            if season_num_match:
                                season_number = int(season_num_match.group(1))
                                matched_season = (season_url, season_number, season_title.strip(), season_year)
                                break
                
                if matched_season:
                    season_url, season_number, season_title, season_year = matched_season
                    if not season_url.startswith('http'):
                        season_url = f"https://www.rottentomatoes.com{season_url}"
                    
                    print(f"Rotten Tomatoes访问匹配的季: {season_url}")
                    try:
                        await page.goto(season_url)
                        await asyncio.sleep(0.2)
                        season_content = await page.content()
                        
                        tmdb_season_number = 1
                        
                        season_json_match = re.search(r'<script[^>]*id="media-scorecard-json"[^>]*>\s*({[^<]+})\s*</script>', season_content)
                        if season_json_match:
                            season_score_data = json.loads(season_json_match.group(1))
                            season_overlay = season_score_data.get("overlay", {})
                            
                            season_has_audience = season_overlay.get("hasAudienceAll", False)
                            season_has_critics = season_overlay.get("hasCriticsAll", False)
                            
                            season_audience = season_overlay.get("audienceAll", {})
                            season_critics = season_overlay.get("criticsAll", {})
                            
                            season_data = {
                                "season_number": tmdb_season_number,
                                "tomatometer": "暂无",
                                "audience_score": "暂无",
                                "critics_avg": "暂无",
                                "critics_count": "暂无",
                                "audience_count": "暂无",
                                "audience_avg": "暂无",
                                "_original_season": season_number,
                                "_season_title": season_title,
                                "_season_year": season_year,
                                "url": page.url
                            }
                            
                            if season_has_critics:
                                season_data["tomatometer"] = season_critics.get("scorePercent", "暂无").rstrip("%") if season_critics.get("scorePercent") else "暂无"
                                season_data["critics_avg"] = season_critics.get("averageRating", "暂无")
                                season_data["critics_count"] = season_critics.get("scoreLinkText", "暂无").split()[0] if season_critics.get("scoreLinkText") else "暂无"
                            
                            if season_has_audience:
                                season_data["audience_score"] = season_audience.get("scorePercent", "暂无").rstrip("%") if season_audience.get("scorePercent") else "暂无"
                                season_data["audience_avg"] = season_audience.get("averageRating", "暂无")
                                season_data["audience_count"] = season_audience.get("bandedRatingCount", "暂无")
                            
                            ratings["seasons"].append(season_data)
                            print(f"Rotten Tomatoes评分获取成功")
                    
                    except Exception as e:
                        print(f"Rotten Tomatoes获取Season {season_number}评分数据时出错: {e}")
                else:
                    print(f"Rotten Tomatoes未找到与年份{tmdb_year}匹配的季")
            
            elif tmdb_info.get("number_of_seasons", 0) == 1:
                print(f"\n[单季剧]Rotten Tomatoes分季处理")
                season_tiles = re.findall(
                    r'<tile-season[^>]*href="([^"]+)"[^>]*>',
                    content,
                    re.DOTALL | re.IGNORECASE
                )
                
                if season_tiles:
                    season_url = season_tiles[0]
                    if not season_url.startswith('http'):
                        season_url = f"https://www.rottentomatoes.com{season_url}"
                    
                    print(f"Rotten Tomatoes访问第一季: {season_url}")
                    try:
                        await page.goto(season_url)
                        await asyncio.sleep(0.2)
                        season_content = await page.content()
                        
                        season_json_match = re.search(r'<script[^>]*id="media-scorecard-json"[^>]*>\s*({[^<]+})\s*</script>', season_content)
                        if season_json_match:
                            season_score_data = json.loads(season_json_match.group(1))
                            season_overlay = season_score_data.get("overlay", {})
                            
                            season_has_audience = season_overlay.get("hasAudienceAll", False)
                            season_has_critics = season_overlay.get("hasCriticsAll", False)
                            
                            if season_has_audience or season_has_critics:
                                season_audience = season_overlay.get("audienceAll", {})
                                season_critics = season_overlay.get("criticsAll", {})
                                
                                season_data = {
                                    "season_number": 1,
                                    "tomatometer": "暂无",
                                    "audience_score": "暂无",
                                    "critics_avg": "暂无",
                                    "critics_count": "暂无",
                                    "audience_count": "暂无",
                                    "audience_avg": "暂无",
                                    "url": season_url
                                }
                                
                                if season_has_critics:
                                    season_data["tomatometer"] = season_critics.get("scorePercent", "暂无").rstrip("%") if season_critics.get("scorePercent") else "暂无"
                                    season_data["critics_avg"] = season_critics.get("averageRating", "暂无")
                                    season_data["critics_count"] = season_critics.get("scoreLinkText", "暂无").split()[0] if season_critics.get("scoreLinkText") else "暂无"
                                
                                if season_has_audience:
                                    season_data["audience_score"] = season_audience.get("scorePercent", "暂无").rstrip("%") if season_audience.get("scorePercent") else "暂无"
                                    season_data["audience_avg"] = season_audience.get("averageRating", "暂无")
                                    season_data["audience_count"] = season_audience.get("bandedRatingCount", "暂无")
                                
                                ratings["seasons"].append(season_data)
                                print(f"Rotten Tomatoes评分获取成功")
                    
                    except Exception as e:
                        print(f"Rotten Tomatoes获取单季剧评分数据时出错: {e}")
                else:
                    print(f"Rotten Tomatoes未找到分季数据")
            
            elif tmdb_info.get("number_of_seasons", 0) > 1:
                print(f"\n[多季剧]Rotten Tomatoes分季处理")
                base_url = page.url.split("/tv/")[1].split("/")[0]
                
                for season in range(1, tmdb_info.get("number_of_seasons", 0) + 1):
                    try:
                        season_url = f"https://www.rottentomatoes.com/tv/{base_url}/s{str(season).zfill(2)}"
                        await page.goto(season_url)
                        season_content = await page.content()
                        
                        season_json_match = re.search(r'<script[^>]*id="media-scorecard-json"[^>]*>\s*({[^<]+})\s*</script>', season_content)
                        if not season_json_match:
                            continue
                            
                        season_score_data = json.loads(season_json_match.group(1))
                        season_overlay = season_score_data.get("overlay", {})
                        
                        season_has_audience = season_overlay.get("hasAudienceAll", False)
                        season_has_critics = season_overlay.get("hasCriticsAll", False)
                        
                        if not season_has_audience and not season_has_critics:
                            continue
                            
                        season_audience = season_overlay.get("audienceAll", {})
                        season_critics = season_overlay.get("criticsAll", {})
                        
                        season_tomatometer = "暂无"
                        season_critics_avg = "暂无"
                        season_critics_count = "暂无"
                        season_audience_avg = "暂无"
                        if season_has_critics:
                            season_tomatometer = season_critics.get("scorePercent", "暂无").rstrip("%") if season_critics.get("scorePercent") else "暂无"
                            season_critics_avg = season_critics.get("averageRating", "暂无")
                            season_critics_count = season_critics.get("scoreLinkText", "暂无").split()[0] if season_critics.get("scoreLinkText") else "暂无"
                            
                        season_audience_score = "暂无"
                        season_audience_avg = "暂无"
                        season_audience_count = "暂无"
                        if season_has_audience:
                            season_audience_score = season_audience.get("scorePercent", "暂无").rstrip("%") if season_audience.get("scorePercent") else "暂无"
                            avg_rating = season_audience.get("averageRating")
                            season_audience_avg = avg_rating if avg_rating and avg_rating not in ["暂无", ""] else "暂无"
                            season_audience_count = season_audience.get("bandedRatingCount", "暂无")
                        
                        season_data = {
                            "season_number": season,
                            "tomatometer": season_tomatometer,
                            "audience_score": season_audience_score,
                            "critics_avg": season_critics_avg,
                            "audience_avg": season_audience_avg,
                            "critics_count": season_critics_count,
                            "audience_count": season_audience_count,
                            "url": season_url
                        }
                        
                        ratings["seasons"].append(season_data)
                        print(f"Rotten Tomatoes第{season}季评分获取成功")
                        
                    except Exception as e:
                        print(f"Rotten Tomatoes获取第{season}季评分数据时出错: {e}")
                        continue
                        
        return ratings
        
    except Exception as e:
        print(f"获取 Rotten Tomatoes 评分数据时出错: {e}")
        return create_empty_rating_data("rottentomatoes", media_type, RATING_STATUS["FETCH_FAILED"])

async def get_metacritic_rating_via_json(page, content=None) -> dict:
    """从Metacritic页面的JSON数据中提取评分"""
    try:
        if content is None:
            content = await page.content()
        flags = _metacritic_tbd_flags(content or "")
        if flags["critic_unavailable"]:
            return None
        
        json_ld_match = re.search(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', content, re.DOTALL)
        if json_ld_match:
            try:
                import json
                json_data = json.loads(json_ld_match.group(1))
                
                if isinstance(json_data, dict) and 'aggregateRating' in json_data:
                    agg_rating = json_data['aggregateRating']
                    
                    rating_value = agg_rating.get('ratingValue')
                    rating_count = agg_rating.get('ratingCount')
                    
                    if rating_value and rating_count:
                        print(f"Metacritic评分获取成功")
                        return {
                            "metascore": str(rating_value),
                            "critics_count": str(rating_count),
                            "source": "json_ld"
                        }
            except Exception as e:
                print(f"Metacritic解析JSON-LD失败: {e}")
        
        react_data_match = re.search(r'window\.__REACT_DATA__\s*=\s*({.*?});', content, re.DOTALL)
        if react_data_match:
            try:
                import json
                react_data = json.loads(react_data_match.group(1))
                
                if 'criticScoreSummary' in react_data:
                    summary = react_data['criticScoreSummary']
                    metascore = summary.get('score')
                    critics_count = summary.get('reviewCount')
                    
                    if metascore and critics_count:
                        print(f"Metacritic评分获取成功")
                        return {
                            "metascore": str(metascore),
                            "critics_count": str(critics_count),
                            "source": "react_data"
                        }
            except Exception as e:
                print(f"Metacritic解析React数据失败: {e}")
        
        return None
        
    except Exception as e:
        print(f"Metacritic JSON提取失败: {e}")
        return None

async def extract_metacritic_rating(page, media_type, tmdb_info):
    """从Metacritic详情页提取评分数据"""
    try:
        content = await page.content()
        json_rating = await get_metacritic_rating_via_json(page, content=content)
        flags = _metacritic_tbd_flags(content)
        
        ratings = {
            "overall": {
                "metascore": "暂无",
                "critics_count": "暂无", 
                "userscore": "暂无",
                "users_count": "暂无"
            },
            "seasons": []
        }
        
        parsed_overall = _metacritic_overall_from_content(content)
        if parsed_overall.get("metascore") not in (None, "", "暂无"):
            ratings["overall"]["metascore"] = parsed_overall["metascore"]
        if parsed_overall.get("critics_count") not in (None, "", "暂无"):
            ratings["overall"]["critics_count"] = parsed_overall["critics_count"]
        if parsed_overall.get("userscore") not in (None, "", "暂无"):
            ratings["overall"]["userscore"] = parsed_overall["userscore"]
        if parsed_overall.get("users_count") not in (None, "", "暂无"):
            ratings["overall"]["users_count"] = parsed_overall["users_count"]

        if json_rating:
            if ratings["overall"]["metascore"] == "暂无" and json_rating.get("metascore") and not flags["critic_unavailable"]:
                ratings["overall"]["metascore"] = json_rating["metascore"]
            if ratings["overall"]["critics_count"] == "暂无" and json_rating.get("critics_count") and not flags["critic_unavailable"]:
                ratings["overall"]["critics_count"] = json_rating["critics_count"]

        if ratings["overall"]["metascore"] == "暂无":
            metascore_match = re.search(r'title="Metascore (\d+) out of 100"', content)
            if metascore_match:
                ratings["overall"]["metascore"] = metascore_match.group(1)
            else:
                metascore_elem = await page.query_selector('div[data-v-e408cafe][title*="Metascore"] span')
                if metascore_elem:
                    metascore_text = await metascore_elem.inner_text()
                    if metascore_text and metascore_text.lower() != 'tbd':
                        ratings["overall"]["metascore"] = metascore_text

        critic_unavailable = flags["critic_unavailable"]
        user_unavailable = flags["user_unavailable"]

        if ratings["overall"]["critics_count"] == "暂无" and not critic_unavailable:
            critics_count_match = re.search(r'Based on (\d+) Critic Reviews?', content)
            if critics_count_match:
                ratings["overall"]["critics_count"] = critics_count_match.group(1)
            else:
                critics_count_elem = await page.query_selector('a[data-testid="critic-path"] span')
                if critics_count_elem:
                    critics_text = await critics_count_elem.inner_text()
                    match = re.search(r'Based on (\d+) Critic', critics_text)
                    if match:
                        ratings["overall"]["critics_count"] = match.group(1)

        if not user_unavailable:
            userscore_match = re.search(r'title="User score ([\d.]+) out of 10"', content)
            if userscore_match:
                ratings["overall"]["userscore"] = userscore_match.group(1)
            else:
                userscore_elem = await page.query_selector('div[data-v-e408cafe][title*="User score"] span')
                if userscore_elem:
                    userscore_text = await userscore_elem.inner_text()
                    if userscore_text and userscore_text.lower() != 'tbd':
                        ratings["overall"]["userscore"] = userscore_text

            users_count_match = re.search(r'Based on ([\d,]+) User Ratings?', content)
            if users_count_match:
                ratings["overall"]["users_count"] = users_count_match.group(1).replace(',', '')
            else:
                users_count_elem = await page.query_selector('a[data-testid="user-path"] span')
                if users_count_elem:
                    users_text = await users_count_elem.inner_text()
                    match = re.search(r'Based on ([\d,]+) User', users_text)
                    if match:
                        ratings["overall"]["users_count"] = match.group(1).replace(',', '')
        
        print(f"Metacritic评分获取成功")

        if media_type == "tv":
            if tmdb_info.get("is_anthology"):
                print(f"\n[选集剧]Metacritic分季处理")
                tmdb_year = tmdb_info.get("year", "")
                
                season_cards = re.findall(
                    r'<div[^>]*data-testid="seasons-modal-card"[^>]*>.*?'
                    r'<a href="([^"]+)".*?'
                    r'SEASON\s+(\d+).*?'
                    r'<span>\s*(\d{4})\s*</span>',
                    content,
                    re.DOTALL | re.IGNORECASE
                )
                
                print(f"Metacritic解析到 {len(season_cards)} 个季")
                
                matched_season = None
                for season_url, season_num, season_year in season_cards:
                    if season_year == tmdb_year:
                        matched_season = (season_url, int(season_num), season_year)
                        break
                
                if matched_season:
                    season_url, season_number, season_year = matched_season
                    if not season_url.startswith('http'):
                        season_url = f"https://www.metacritic.com{season_url}"
                    
                    print(f"Metacritic访问匹配的季: {season_url}")
                    try:
                        await page.goto(season_url, wait_until='networkidle')
                        await asyncio.sleep(0.5)

                        tmdb_season_number = 1
                        
                        season_data = {
                            "season_number": tmdb_season_number,
                            "metascore": "暂无",
                            "critics_count": "暂无",
                            "userscore": "暂无",
                            "users_count": "暂无",
                            "_original_season": season_number,
                            "_season_year": season_year,
                            "url": season_url
                        }

                        season_content = await page.content()
                        
                        season_metascore_match = re.search(r'title="Metascore (\d+) out of 100"', season_content)
                        if season_metascore_match:
                            season_data["metascore"] = season_metascore_match.group(1)
                        
                        season_critics_count_match = re.search(r'Based on (\d+) Critic Reviews?', season_content)
                        if season_critics_count_match:
                            season_data["critics_count"] = season_critics_count_match.group(1)
                        
                        season_userscore_match = re.search(r'title="User score ([\d.]+) out of 10"', season_content)
                        if season_userscore_match:
                            season_data["userscore"] = season_userscore_match.group(1)
                        
                        season_users_count_match = re.search(r'Based on ([\d,]+) User Ratings?', season_content)
                        if season_users_count_match:
                            season_data["users_count"] = season_users_count_match.group(1).replace(',', '')

                        ratings["seasons"].append(season_data)
                        print(f"Metacritic评分获取成功")

                    except Exception as e:
                        print(f"Metacritic获取Season {season_number}评分数据时出错: {e}")
                else:
                    print(f"Metacritic未找到与年份{tmdb_year}匹配的季")
            
            elif tmdb_info.get("number_of_seasons", 0) == 1:
                print(f"\n[单季剧集]Metacritic分季处理")
                season_cards = re.findall(
                    r'<div[^>]*data-testid="seasons-modal-card"[^>]*>.*?'
                    r'<a href="([^"]+)"',
                    content,
                    re.DOTALL | re.IGNORECASE
                )
                
                if season_cards:
                    season_url = season_cards[0]
                    if not season_url.startswith('http'):
                        season_url = f"https://www.metacritic.com{season_url}"
                    
                    print(f"Metacritic访问第一季: {season_url}")
                    try:
                        await page.goto(season_url, wait_until='networkidle')
                        await asyncio.sleep(0.5)
                        
                        season_data = {
                            "season_number": 1,
                            "metascore": "暂无",
                            "critics_count": "暂无",
                            "userscore": "暂无",
                            "users_count": "暂无",
                            "url": season_url
                        }

                        season_content = await page.content()
                        
                        season_metascore_match = re.search(r'title="Metascore (\d+) out of 100"', season_content)
                        if season_metascore_match:
                            season_data["metascore"] = season_metascore_match.group(1)
                        
                        season_critics_count_match = re.search(r'Based on (\d+) Critic Reviews?', season_content)
                        if season_critics_count_match:
                            season_data["critics_count"] = season_critics_count_match.group(1)
                        
                        season_userscore_match = re.search(r'title="User score ([\d.]+) out of 10"', season_content)
                        if season_userscore_match:
                            season_data["userscore"] = season_userscore_match.group(1)
                        
                        season_users_count_match = re.search(r'Based on ([\d,]+) User Ratings?', season_content)
                        if season_users_count_match:
                            season_data["users_count"] = season_users_count_match.group(1).replace(',', '')

                        ratings["seasons"].append(season_data)
                        print(f"Metacritic评分获取成功")

                    except Exception as e:
                        print(f"Metacritic获取单季剧评分数据时出错: {e}")
                else:
                    print(f"Metacritic未找到分季数据")
            
            elif tmdb_info.get("number_of_seasons", 0) > 1:
                print(f"\n[多季剧集]Metacritic分季处理")
                base_url = page.url.rstrip('/')
                
                for season in tmdb_info.get("seasons", []):
                    season_number = season.get("season_number")
                    try:
                        season_url = f"{base_url}/season-{season_number}/"
                        await page.goto(season_url, wait_until='networkidle')
                        await asyncio.sleep(0.5)

                        season_data = {
                            "season_number": season_number,
                            "metascore": "暂无",
                            "critics_count": "暂无",
                            "userscore": "暂无",
                            "users_count": "暂无",
                            "url": season_url
                        }

                        season_content = await page.content()
                        
                        season_metascore_match = re.search(r'title="Metascore (\d+) out of 100"', season_content)
                        if season_metascore_match:
                            season_data["metascore"] = season_metascore_match.group(1)
                        
                        season_critics_count_match = re.search(r'Based on (\d+) Critic Reviews?', season_content)
                        if season_critics_count_match:
                            season_data["critics_count"] = season_critics_count_match.group(1)
                        
                        season_userscore_match = re.search(r'title="User score ([\d.]+) out of 10"', season_content)
                        if season_userscore_match:
                            season_data["userscore"] = season_userscore_match.group(1)
                        
                        season_users_count_match = re.search(r'Based on ([\d,]+) User Ratings?', season_content)
                        if season_users_count_match:
                            season_data["users_count"] = season_users_count_match.group(1).replace(',', '')

                        ratings["seasons"].append(season_data)
                        print(f"Metacritic第{season_number}季评分获取成功")

                    except Exception as e:
                        print(f"Metacritic获取第{season_number}季评分数据时出错: {e}")
                        continue

        all_no_rating = all(
            value == "暂无" or value == "tbd" 
            for value in [
                ratings["overall"]["metascore"],
                ratings["overall"]["critics_count"],
                ratings["overall"]["userscore"],
                ratings["overall"]["users_count"]
            ]
        )
        
        ratings["status"] = (
            RATING_STATUS["NO_RATING"] if all_no_rating
            else RATING_STATUS["SUCCESSFUL"]
        )

        return ratings

    except Exception as e:
        print(f"提取Metacritic评分数据时出错: {e}")
        return create_empty_rating_data("metacritic", media_type, RATING_STATUS["FETCH_FAILED"])

async def extract_letterboxd_rating(page):
    """从Letterboxd详情页提取评分数据"""
    try:
        content = await page.content()
        
        json_match = re.search(r'"aggregateRating":\s*{\s*"bestRating":\s*(\d+),\s*"reviewCount":\s*(\d+),\s*"@type":\s*"aggregateRating",\s*"ratingValue":\s*([\d.]+),\s*"description":\s*"[^"]*",\s*"ratingCount":\s*(\d+),\s*"worstRating":\s*(\d+)\s*}', content)
        
        if json_match:
            rating = json_match.group(3)
            rating_count = json_match.group(4)
            print(f"Letterboxd评分获取成功")
            
            return {
                "rating": rating,
                "rating_count": rating_count,
                "status": (
                    RATING_STATUS["SUCCESSFUL"]
                    if _letterboxd_scores_has_rating(rating, rating_count)
                    else RATING_STATUS["NO_RATING"]
                )
            }
        else:            
            rating_elem = await page.query_selector('span.average-rating a.tooltip')
            
            if not rating_elem:
                print("Letterboxd 未找到评分元素")
                return {
                    "rating": "暂无",
                    "rating_count": "暂无",
                    "status": RATING_STATUS["NO_RATING"]
                }
                
            rating = await rating_elem.inner_text()
            
            tooltip = await rating_elem.get_attribute('data-original-title')
            if tooltip:
                match = re.search(r'based on ([\d,]+)', tooltip)
                rating_count = match.group(1).replace(',', '') if match else "暂无"
            else:
                rating_count = "暂无"
            
            print(f"Letterboxd评分获取成功")
            
            return {
                "rating": rating,
                "rating_count": rating_count,
                "status": (
                    RATING_STATUS["SUCCESSFUL"]
                    if _letterboxd_scores_has_rating(rating, rating_count)
                    else RATING_STATUS["NO_RATING"]
                )
            }
            
    except Exception as e:
        print(f"提取Letterboxd评分数据时出错: {e}")
        return {
            "rating": "暂无",
            "rating_count": "暂无",
            "status": "Fail"
        }
        
def check_movie_status(platform_data, platform):
    """检查电影评分数据的状态"""
    if not platform_data:
        return RATING_STATUS["FETCH_FAILED"]
        
    if "status" in platform_data:
        return platform_data["status"]
        
    if platform == "douban":
        if platform_data.get("rating") == "暂无" and platform_data.get("rating_people") == "暂无":
            return RATING_STATUS["NO_RATING"]
        return RATING_STATUS["SUCCESSFUL"] if (platform_data.get("rating") not in [None, "暂无"] and 
                                            platform_data.get("rating_people") not in [None, "暂无"]) else RATING_STATUS["FETCH_FAILED"]
        
    elif platform == "imdb":
        if platform_data.get("rating") == "暂无" and platform_data.get("rating_people") == "暂无":
            return RATING_STATUS["NO_RATING"]
        return RATING_STATUS["SUCCESSFUL"] if (platform_data.get("rating") not in [None, "暂无", "N/A"] and 
                                            platform_data.get("rating_people") not in [None, "暂无", "N/A"]) else RATING_STATUS["FETCH_FAILED"]
        
    elif platform == "rottentomatoes":
        series_data = platform_data.get("series", {})
        required_fields = ["tomatometer", "audience_score", "critics_avg", "critics_count", "audience_count", "audience_avg"]
        all_no_rating = all(series_data.get(key) == "暂无" for key in required_fields)
        if all_no_rating:
            return RATING_STATUS["NO_RATING"]
        return RATING_STATUS["SUCCESSFUL"] if all(series_data.get(key) not in [None, "暂无"] for key in required_fields) else RATING_STATUS["FETCH_FAILED"]
        
    elif platform == "metacritic":
        overall_data = platform_data.get("overall", {})
        required_fields = ["metascore", "critics_count", "userscore", "users_count"]
        all_no_rating = all(overall_data.get(key) == "暂无" for key in required_fields)
        if all_no_rating:
            return RATING_STATUS["NO_RATING"]
        return RATING_STATUS["SUCCESSFUL"] if all(overall_data.get(key) not in [None, "暂无"] for key in required_fields) else RATING_STATUS["FETCH_FAILED"]
    
    elif platform == "letterboxd":
        if platform_data.get("rating") == "暂无" and platform_data.get("rating_count") == "暂无":
            return RATING_STATUS["NO_RATING"]
        return RATING_STATUS["SUCCESSFUL"] if (platform_data.get("rating") not in [None, "暂无"] and 
                                            platform_data.get("rating_count") not in [None, "暂无"]) else RATING_STATUS["FETCH_FAILED"]
    
    elif platform == "trakt":
        if platform_data.get("rating") == "暂无" and platform_data.get("votes") == "暂无":
            return RATING_STATUS["NO_RATING"]
        return RATING_STATUS["SUCCESSFUL"] if (platform_data.get("rating") not in [None, "暂无"] and 
                                            platform_data.get("votes") not in [None, "暂无"]) else RATING_STATUS["FETCH_FAILED"]
    
    return RATING_STATUS["FETCH_FAILED"]

def check_tv_status(platform_data, platform):
    """检查剧集评分数据的状态"""
    if not platform_data:
        return RATING_STATUS["FETCH_FAILED"]
        
    if "status" in platform_data:
        return platform_data["status"]
        
    if platform == "douban":
        seasons = platform_data.get("seasons", [])
        if not seasons:
            return RATING_STATUS["FETCH_FAILED"]
            
        all_no_rating = all(
            season.get("rating") == "暂无" and season.get("rating_people") == "暂无"
            for season in seasons
        )
        if all_no_rating:
            return RATING_STATUS["NO_RATING"]
            
        for season in seasons:
            season_fields = ["rating", "rating_people"]
            if not all(season.get(key) not in [None, "暂无"] for key in season_fields):
                return RATING_STATUS["FETCH_FAILED"]
        return RATING_STATUS["SUCCESSFUL"]
        
    elif platform == "imdb":
        if platform_data.get("rating") == "暂无" and platform_data.get("rating_people") == "暂无":
            return RATING_STATUS["NO_RATING"]
        return RATING_STATUS["SUCCESSFUL"] if (platform_data.get("rating") not in [None, "暂无", "N/A"] and 
                                            platform_data.get("rating_people") not in [None, "暂无", "N/A"]) else RATING_STATUS["FETCH_FAILED"]
        
    elif platform == "rottentomatoes":
        series_data = platform_data.get("series", {})
        seasons_data = platform_data.get("seasons", [])
        
        series_fields = ["tomatometer", "audience_score", "critics_avg", "critics_count", "audience_count", "audience_avg"]
        all_series_no_rating = all(series_data.get(key) in ["暂无", "tbd"] for key in series_fields)
        
        all_seasons_no_rating = all(
            all(season.get(key) in ["暂无", "tbd"] for key in ["tomatometer", "audience_score", "critics_avg", "audience_avg", "critics_count", "audience_count"])
            for season in seasons_data
        )
        
        if all_series_no_rating and all_seasons_no_rating:
            return RATING_STATUS["NO_RATING"]
            
        if not all(series_data.get(key) not in [None, "出错"] for key in series_fields):
            return RATING_STATUS["FETCH_FAILED"]
            
        for season in seasons_data:
            season_fields = ["tomatometer", "audience_score", "critics_avg", "audience_avg", "critics_count", "audience_count"]
            if not all(season.get(key) in ["暂无", "tbd"] or season.get(key) not in [None, "出错"] for key in season_fields):
                return RATING_STATUS["FETCH_FAILED"]
        return RATING_STATUS["SUCCESSFUL"]
        
    elif platform == "metacritic":
        overall_data = platform_data.get("overall", {})
        seasons_data = platform_data.get("seasons", [])
        
        overall_fields = ["metascore", "critics_count", "userscore", "users_count"]
        all_overall_no_rating = all(overall_data.get(key) in ["暂无", "tbd"] for key in overall_fields)
        
        all_seasons_no_rating = all(
            all(season.get(key) in ["暂无", "tbd"] for key in ["metascore", "critics_count", "userscore", "users_count"])
            for season in seasons_data
        )
        
        if all_overall_no_rating and all_seasons_no_rating:
            return RATING_STATUS["NO_RATING"]
            
        if not all(overall_data.get(key) not in [None, "出错"] for key in overall_fields):
            return RATING_STATUS["FETCH_FAILED"]
            
        for season in seasons_data:
            season_fields = ["metascore", "critics_count", "userscore", "users_count"]
            if not all(season.get(key) in ["暂无", "tbd"] or season.get(key) not in [None, "出错"] for key in season_fields):
                return RATING_STATUS["FETCH_FAILED"]
        return RATING_STATUS["SUCCESSFUL"]
    
    elif platform == "letterboxd":
        if platform_data.get("rating") == "暂无" and platform_data.get("rating_count") == "暂无":
            return RATING_STATUS["NO_RATING"]
        return RATING_STATUS["SUCCESSFUL"] if (platform_data.get("rating") not in [None, "暂无"] and 
                                            platform_data.get("rating_count") not in [None, "暂无"]) else RATING_STATUS["FETCH_FAILED"]
    
    elif platform == "trakt":
        if platform_data.get("rating") == "暂无" and platform_data.get("votes") == "暂无":
            return RATING_STATUS["NO_RATING"]
        return RATING_STATUS["SUCCESSFUL"] if (platform_data.get("rating") not in [None, "暂无"] and 
                                            platform_data.get("votes") not in [None, "暂无"]) else RATING_STATUS["FETCH_FAILED"]
    
    return RATING_STATUS["FETCH_FAILED"]

def create_empty_rating_data(platform, media_type, status):
    """创建带有状态的空评分数据结构"""
    if platform == "douban":
        return {
            "seasons": [] if media_type == "tv" else None,
            "rating": "暂无",
            "rating_people": "暂无",
            "status": status
        }
    elif platform == "imdb":
        return {
            "rating": "暂无",
            "rating_people": "暂无",
            "status": status
        }
    elif platform == "letterboxd":
        return {
            "rating": "暂无",
            "rating_count": "暂无",
            "status": status
        }
    elif platform == "rottentomatoes":
        return {
            "series": {
                "tomatometer": "暂无",
                "audience_score": "暂无",
                "critics_avg": "暂无",
                "critics_count": "暂无",
                "audience_count": "暂无",
                "audience_avg": "暂无",
                "status": status
            },
            "seasons": [],
            "status": status
        }
    elif platform == "metacritic":
        return {
            "overall": {
                "metascore": "暂无",
                "critics_count": "暂无",
                "userscore": "暂无",
                "users_count": "暂无",
                "status": status
            },
            "seasons": [],
            "status": status
        }
    elif platform == "trakt":
        return {
            "rating": "暂无",
            "votes": "暂无",
            "distribution": {},
            "url": "",
            "status": status
        }

def create_error_rating_data(platform, media_type="movie", status=RATING_STATUS["FETCH_FAILED"], status_reason="获取失败"):
    """为出错的平台创建数据结构"""
    if platform == "douban":
        if media_type == "tv":
            return {
                "seasons": [],
                "rating": "出错",
                "rating_people": "出错",
                "status": status,
                "status_reason": status_reason
            }
        else:
            return {
                "rating": "出错",
                "rating_people": "出错",
                "status": status,
                "status_reason": status_reason
            }
            
    elif platform == "imdb":
        return {
            "rating": "出错",
            "rating_people": "出错",
            "status": status,
            "status_reason": status_reason
        }
        
    elif platform == "letterboxd":
        return {
            "rating": "出错",
            "rating_count": "出错",
            "status": status,
            "status_reason": status_reason
        }
    
    elif platform == "trakt":
        return {
            "rating": "出错",
            "votes": "出错",
            "distribution": {},
            "url": "",
            "status": status,
            "status_reason": status_reason
        }
        
    elif platform == "rottentomatoes":
        if media_type == "tv":
            return {
                "series": {
                    "tomatometer": "出错",
                    "audience_score": "出错",
                    "critics_avg": "出错",
                    "audience_avg": "出错",
                    "critics_count": "出错",
                    "audience_count": "出错",
                    "status": status,
                    "status_reason": status_reason
                },
                "seasons": [],
                "status": status,
                "status_reason": status_reason
            }
        else:
            return {
                "series": {
                    "tomatometer": "出错",
                    "audience_score": "出错",
                    "critics_avg": "出错",
                    "audience_avg": "出错",
                    "critics_count": "出错",
                    "audience_count": "出错",
                    "status": status,
                    "status_reason": status_reason
                },
                "status": status,
                "status_reason": status_reason
            }
            
    elif platform == "metacritic":
        if media_type == "tv":
            return {
                "overall": {
                    "metascore": "出错",
                    "critics_count": "出错",
                    "userscore": "出错",
                    "users_count": "出错",
                    "status": status,
                    "status_reason": status_reason
                },
                "seasons": [],
                "status": status,
                "status_reason": status_reason
            }
        else:
            return {
                "overall": {
                    "metascore": "出错",
                    "critics_count": "出错",
                    "userscore": "出错",
                    "users_count": "出错",
                    "status": status,
                    "status_reason": status_reason
                },
                "status": status,
                "status_reason": status_reason
            }
    
    return {
        "rating": "出错",
        "rating_people": "出错",
        "status": status,
        "status_reason": status_reason
    }

def format_rating_output(all_ratings, media_type):
    """格式化所有平台的评分信息"""
    formatted_data = copy.deepcopy(all_ratings)
    
    for platform, data in formatted_data.items():
        if media_type == "movie":
            status = check_movie_status(data, platform)
        else:
            status = check_tv_status(data, platform)
            
        if platform in ["douban", "imdb", "letterboxd"]:
            data["status"] = status
        elif platform == "rottentomatoes":
            if "series" in data:
                data["series"]["status"] = status
            if "seasons" in data:
                for season in data["seasons"]:
                    season["status"] = status
            data["status"] = status
        elif platform == "metacritic":
            if "overall" in data:
                data["overall"]["status"] = status
            if "seasons" in data:
                for season in data["seasons"]:
                    season["status"] = status
            data["status"] = status
    
    return formatted_data

async def parallel_extract_ratings(tmdb_info, media_type, request=None, douban_cookie=None, mapping: Optional[dict] = None):
    """并行处理所有平台的评分获取"""
    import time
    start_time = time.time()

    platforms = ["douban", "imdb", "letterboxd", "rottentomatoes", "metacritic"]

    platform_timeouts = {
        "douban": 6.0,
        "imdb": 12.0,
        "letterboxd": 18.0,
        "rottentomatoes": 12.0,
        "metacritic": 12.0,
    }
    
    title = tmdb_info.get('zh_title') or tmdb_info.get('title', 'Unknown')
    print(log.section(f"并行获取评分: {title} ({media_type})"))
    
    is_anthology = tmdb_info.get("is_anthology", False)
    
    async def process_platform(platform):
        platform_start = time.time()
        try:
            if request and await request.is_disconnected():
                return platform, {"status": "cancelled"}
                
            cookie = douban_cookie if platform == "douban" else None
            used_mapping = False

            if mapping and isinstance(mapping, dict):
                try:
                    if platform == "douban" and media_type == "movie":
                        url = (mapping.get("douban_url") or "").strip()
                        if url:
                            used_mapping = True
                            rating_data = await extract_rating_info(
                                media_type,
                                platform,
                                tmdb_info,
                                build_direct_mapping_search_results(platform, tmdb_info, url),
                                request,
                                cookie,
                            )
                        else:
                            rating_data = None
                    elif platform == "letterboxd":
                        slug = (mapping.get("letterboxd_slug") or "").strip().strip("/")
                        url = f"https://letterboxd.com/film/{slug}/" if slug else ""
                        if url:
                            used_mapping = True
                            rating_data = await extract_rating_info(
                                media_type,
                                platform,
                                tmdb_info,
                                build_direct_mapping_search_results(platform, tmdb_info, url),
                                request,
                                cookie,
                            )
                        else:
                            rating_data = None
                    elif platform == "rottentomatoes":
                        slug = (mapping.get("rotten_tomatoes_slug") or "").strip().lstrip("/")
                        url = f"https://www.rottentomatoes.com/{slug}" if slug else ""
                        if url:
                            used_mapping = True
                            rating_data = await extract_rating_info(
                                media_type,
                                platform,
                                tmdb_info,
                                build_direct_mapping_search_results(platform, tmdb_info, url),
                                request,
                                cookie,
                            )
                        else:
                            rating_data = None
                    elif platform == "metacritic":
                        slug = (mapping.get("metacritic_slug") or "").strip().lstrip("/")
                        url = f"https://www.metacritic.com/{slug}" if slug else ""
                        if url:
                            used_mapping = True
                            rating_data = await extract_rating_info(
                                media_type,
                                platform,
                                tmdb_info,
                                build_direct_mapping_search_results(platform, tmdb_info, url),
                                request,
                                cookie,
                            )
                        else:
                            rating_data = None
                    else:
                        rating_data = None
                except Exception:
                    rating_data = None
            else:
                rating_data = None

            if platform == "douban" and not used_mapping:
                rating_data = await douban_search_and_extract_rating(media_type, tmdb_info, request, cookie)

            if platform != "douban" and not used_mapping:
                search_results = await search_platform(platform, tmdb_info, request, cookie)
                if isinstance(search_results, dict) and "status" in search_results:
                    elapsed = time.time() - platform_start
                    print(
                        log.error(
                            f"{platform}: {search_results.get('status_reason', search_results.get('status'))} ({elapsed:.1f}s)"
                        )
                    )
                    return platform, search_results

                rating_data = await extract_rating_info(media_type, platform, tmdb_info, search_results, request, cookie)
            
            elapsed = time.time() - platform_start
            status = rating_data.get('status', 'Unknown')
            if status == RATING_STATUS["SUCCESSFUL"]:
                rating = rating_data.get('rating') or rating_data.get('series', {}).get('tomatometer', '?')
                print(log.success(f"{platform}: {rating} ({elapsed:.1f}s)"))
            else:
                print(log.warning(f"{platform}: {status} ({elapsed:.1f}s)"))
            
            return platform, rating_data
            
        except Exception as e:
            elapsed = time.time() - platform_start
            print(log.error(f"{platform}: {str(e)[:50]} ({elapsed:.1f}s)"))
            
            error_str = str(e).lower()
            if "rate limit" in error_str or "频率限制" in error_str:
                return platform, create_error_rating_data(platform, media_type, RATING_STATUS["RATE_LIMIT"], "访问频率限制")
            elif "timeout" in error_str or "超时" in error_str:
                return platform, create_error_rating_data(platform, media_type, RATING_STATUS["TIMEOUT"], "请求超时")
            else:
                return platform, create_error_rating_data(platform, media_type)
    
    sem = asyncio.Semaphore(5)

    async def process_with_semaphore(platform):
        timeout = platform_timeouts.get(platform, 15.0)
        async with sem:
            try:
                return await asyncio.wait_for(process_platform(platform), timeout=timeout)
            except asyncio.TimeoutError:
                elapsed = time.time() - start_time
                print(log.error(f"{platform}: overall timeout after {timeout:.1f}s (elapsed {elapsed:.1f}s)"))
                return platform, create_error_rating_data(
                    platform,
                    media_type,
                    RATING_STATUS["TIMEOUT"],
                    f"整体超时 {timeout:.1f} 秒",
                )
    
    if is_anthology and media_type == "tv":
        print("检测到选集剧，先执行IMDB，然后执行其他平台...")
        
        imdb_result = await process_with_semaphore("imdb")
        imdb_platform, imdb_rating = imdb_result
        
        print(f"IMDB完成，开始执行其他平台（烂番茄和MTC将使用主系列信息）...")
        
        other_platforms = [p for p in platforms if p != "imdb"]
        other_tasks = [process_with_semaphore(platform) for platform in other_platforms]
        other_results = await asyncio.gather(*other_tasks)
        
        all_ratings = {imdb_platform: imdb_rating}
        all_ratings.update({platform: rating for platform, rating in other_results})
    else:
        tasks = [process_with_semaphore(platform) for platform in platforms]
        results = await asyncio.gather(*tasks)
        all_ratings = {platform: rating for platform, rating in results}
    
    total_time = time.time() - start_time
    success_count = sum(1 for r in all_ratings.values() if r.get('status') == RATING_STATUS["SUCCESSFUL"])
    print(f"\n{log.success(f'完成 {success_count}/{len(platforms)} 个平台')} | 总耗时: {total_time:.2f}秒\n")
    
    return format_rating_output(all_ratings, media_type)

async def main():
    try:
        tmdb_id = input("请输入TMDB ID:")
        print("请输入媒体类型(movie/tv),5秒后默认尝试movie类型:")
        
        media_type = None
        try:
            media_type = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(None, input),
                timeout=5.0
            )
            if media_type not in ["movie", "tv"]:
                print("无效的媒体类型,默认使用movie类型")
                media_type = "movie"
        except asyncio.TimeoutError:
            print("未输入媒体类型,默认使用movie类型")
            media_type = "movie"
            
        all_platforms = ["douban", "imdb", "letterboxd", "rottentomatoes", "metacritic"]
        print("\n可用平台:", ", ".join(all_platforms))
        print("请输入要测试的平台(多个平台用空格分隔),5秒后默认测试所有平台:")
        
        try:
            platforms_input = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(None, input),
                timeout=5.0
            )
            
            if platforms_input.strip():
                platforms = [p.strip().lower() for p in platforms_input.split()]
                invalid_platforms = [p for p in platforms if p not in all_platforms]
                if invalid_platforms:
                    print(f"警告: 无效的平台 {', '.join(invalid_platforms)}, 这些平台将被忽略")
                    platforms = [p for p in platforms if p in all_platforms]
                if not platforms:
                    print("没有有效的平台输入,将测试所有平台")
                    platforms = all_platforms
            else:
                print("未指定平台,将测试所有平台")
                platforms = all_platforms
                
        except asyncio.TimeoutError:
            print("未在5秒内输入平台,默认测试所有平台")
            platforms = all_platforms
        
        tmdb_info = await get_tmdb_info(tmdb_id, media_type)
        if tmdb_info is None:
            print("获取TMDB信息失败，无法继续执行后续流程")
            return
        
        media_type = tmdb_info["type"]
        print(f"\n开始获取以下平台的评分信息: {', '.join(platforms)}...")
        
        sem = asyncio.Semaphore(5)
        
        async def process_platform(platform):
            async with sem:
                try:
                    print(f"开始获取 {platform} 平台评分...")
                    if platform == "douban":
                        rating_data = await douban_search_and_extract_rating(
                            media_type, tmdb_info, None, None
                        )
                        return platform, rating_data
                    search_results = await search_platform(platform, tmdb_info)
                    if isinstance(search_results, dict) and "status" in search_results:
                        return platform, search_results

                    rating_data = await extract_rating_info(
                        media_type, platform, tmdb_info, search_results
                    )
                    return platform, rating_data
                    
                except Exception as e:
                    print(f"处理 {platform} 平台时出错: {e}")
                    print(traceback.format_exc())
                    return platform, create_empty_rating_data(platform, media_type, RATING_STATUS["FETCH_FAILED"])
        
        tasks = [process_platform(platform) for platform in platforms]
        
        try:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            all_ratings = {}
            for result in results:
                if isinstance(result, Exception):
                    print(f"任务执行出错: {result}")
                    continue
                    
                platform, rating_data = result
                all_ratings[platform] = rating_data
                print(f"{platform} 平台评分信息获取完成")
        
            if all_ratings:
                formatted_ratings = format_rating_output(all_ratings, media_type)
                return formatted_ratings                
            else:
                print("\n=== 评分信息汇总 ===\n未能获取到任何平台的评分信息")
                return {}
            
        except Exception as e:
            print(f"并发获取评分信息时出错: {e}")
            print(traceback.format_exc())
            return {}
            
    except Exception as e:
        print(f"执行过程中出错: {e}")
        print(traceback.format_exc())
        return {}
    
if __name__ == "__main__":
    asyncio.run(main())
    
