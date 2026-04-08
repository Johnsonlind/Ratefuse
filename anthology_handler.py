# ==========================================
# 选集剧处理模块
# ==========================================
import os
import re
import aiohttp
import logging
from typing import Optional, Dict, List, Any
from fuzzywuzzy import fuzz

logger = logging.getLogger(__name__)

TMDB_API_KEY = os.getenv("TMDB_API_KEY", "")
TMDB_API_BASE_URL = os.getenv("TMDB_API_BASE_URL", "").rstrip("/")
TRAKT_CLIENT_ID = os.getenv("TRAKT_CLIENT_ID", "")
TRAKT_BASE_URL = os.getenv("TRAKT_BASE_URL", "").rstrip("/")

ANTHOLOGY_TITLE_PATTERNS = [
    r'^(.+?):\s*(?:The\s+)?(.+?)\s+Story',
    r'^(.+?):\s*Season\s+\d+',
    r'^(.+?)\s*[-–]\s*(.+?)$',
    r'^(.+?):\s*(.+?)$',
]

class AnthologyHandler:
    """选集剧处理器 - 处理跨平台搜索和评分获取"""
    
    def __init__(self):
        self.tmdb_api_key = TMDB_API_KEY
        self.trakt_api_key = TRAKT_CLIENT_ID
    
    def is_anthology_series(self, tmdb_info: Dict[str, Any]) -> bool:
        """
        启发式判断是否为选集剧
        用于决定是否需要多策略搜索，不保证100%准确
        """
        if tmdb_info.get("type") != "tv":
            return False
        
        title = tmdb_info.get("title", "")
        original_title = tmdb_info.get("original_title", "")
        
        for pattern in ANTHOLOGY_TITLE_PATTERNS:
            if re.search(pattern, title, re.IGNORECASE):
                logger.info(f"通过标题模式识别为可能的选集剧: {title}")
                return True
            if original_title and re.search(pattern, original_title, re.IGNORECASE):
                logger.info(f"通过原标题模式识别为可能的选集剧: {original_title}")
                return True
        
        number_of_seasons = tmdb_info.get("number_of_seasons", 0)
        if number_of_seasons == 1:
            keywords = ["story", "tale", "chapter", "anthology"]
            title_lower = title.lower()
            if any(keyword in title_lower for keyword in keywords):
                logger.info(f"单季剧集包含选集剧关键词: {title}")
                return True
        
        return False
    
    def extract_main_series_info(self, tmdb_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """从标题动态提取主系列信息，避免硬编码维护成本"""
        title = tmdb_info.get("title", "")
        original_title = tmdb_info.get("original_title", "")
        year = tmdb_info.get("year", "")
        
        for pattern in ANTHOLOGY_TITLE_PATTERNS:
            match = re.match(pattern, title, re.IGNORECASE)
            if match:
                main_title = match.group(1).strip()
                logger.info(f"从标题提取主系列: {main_title}")
                return {
                    "main_title": main_title,
                    "first_air_year": year,
                    "detected": True,
                    "source": "title_pattern"
                }
            
            if original_title:
                match = re.match(pattern, original_title, re.IGNORECASE)
                if match:
                    main_title = match.group(1).strip()
                    logger.info(f"从原标题提取主系列: {main_title}")
                    return {
                        "main_title": main_title,
                        "first_air_year": year,
                        "detected": True,
                        "source": "original_title_pattern"
                    }
        
        return None
    
    def extract_subtitle_from_title(self, title: str) -> Optional[str]:
        """提取完整副标题用于精确匹配"""
        if ': ' in title:
            parts = title.split(': ', 1)
            if len(parts) == 2:
                subtitle = parts[1].strip()
                logger.info(f"提取副标题: '{title}' -> '{subtitle}'")
                return subtitle
        
        for pattern in ANTHOLOGY_TITLE_PATTERNS:
            match = re.match(pattern, title, re.IGNORECASE)
            if match and len(match.groups()) >= 2:
                subtitle = match.group(2).strip()
                logger.info(f"通过模式提取副标题: '{title}' -> '{subtitle}'")
                return subtitle
        
        return None
    
    async def get_imdb_id_from_multiple_sources(
        self, 
        tmdb_info: Dict[str, Any], 
        series_info: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """多来源获取IMDB ID"""
        if tmdb_info.get("imdb_id"):
            logger.info(f"✓ 从TMDB获取到IMDB ID: {tmdb_info['imdb_id']}")
            return tmdb_info["imdb_id"]
        
        try:
            tmdb_id = tmdb_info.get("tmdb_id")
            media_type = tmdb_info.get("type", "tv")
            
            if tmdb_id:
                imdb_id = await self._get_imdb_from_tmdb_external_ids(tmdb_id, media_type)
                if imdb_id:
                    logger.info(f"✓ 从TMDB外部ID API获取到IMDB ID: {imdb_id}")
                    return imdb_id
        except Exception as e:
            logger.error(f"✗ 从TMDB外部ID API获取IMDB ID失败: {e}")
        
        try:
            title = tmdb_info.get("title") or tmdb_info.get("original_title")
            year = tmdb_info.get("year")
            media_type = tmdb_info.get("type", "tv")
            
            if title:
                imdb_id = await self._search_imdb_id(title, year, media_type)
                if imdb_id:
                    logger.info(f"⚠ 通过搜索获取到IMDB ID（可能不准确）: {imdb_id}")
                    return imdb_id
        except Exception as e:
            logger.error(f"✗ 通过搜索获取IMDB ID失败: {e}")
        
        logger.warning("✗ 无法从任何来源获取IMDB ID")
        return None
    
    async def _get_imdb_from_tmdb_external_ids(self, tmdb_id: int, media_type: str) -> Optional[str]:
        """从TMDB外部ID API获取IMDB ID"""
        try:
            url = f"{TMDB_API_BASE_URL}/{media_type}/{tmdb_id}/external_ids"
            params = {"api_key": self.tmdb_api_key}
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        imdb_id = data.get("imdb_id")
                        if imdb_id:
                            return imdb_id
        except Exception as e:
            logger.error(f"从TMDB外部ID API获取IMDB ID失败: {e}")
        
        return None
    
    async def get_main_series_info_from_first_episode(
        self, 
        tmdb_id: int, 
        season_number: int = 1, 
        episode_number: int = 1
    ) -> Optional[Dict[str, Any]]:
        try:
            episode_imdb_id = await self._get_episode_imdb_id(tmdb_id, season_number, episode_number)
            if not episode_imdb_id:
                logger.warning(f"无法获取第一集(Season {season_number}, Episode {episode_number})的IMDB ID")
                return None
            
            logger.info(f"获取到第一集的IMDB ID: {episode_imdb_id}")
            
            main_series_info = await self._get_main_series_from_episode_imdb(episode_imdb_id)
            if main_series_info:
                logger.info(f"成功获取主系列信息: {main_series_info.get('title')} ({main_series_info.get('year')})")
                return main_series_info
            else:
                logger.warning(f"无法通过第一集IMDB ID {episode_imdb_id} 获取主系列信息")
                return None
                
        except Exception as e:
            logger.error(f"获取主系列信息失败: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return None
    
    async def _get_episode_imdb_id(self, tmdb_id: int, season_number: int, episode_number: int) -> Optional[str]:
        """从TMDB API获取指定集的IMDB ID"""
        try:
            url = f"{TMDB_API_BASE_URL}/tv/{tmdb_id}/season/{season_number}/episode/{episode_number}/external_ids"
            params = {"api_key": self.tmdb_api_key}
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        imdb_id = data.get("imdb_id")
                        if imdb_id:
                            logger.info(f"从TMDB获取到第{season_number}季第{episode_number}集的IMDB ID: {imdb_id}")
                            return imdb_id
                    else:
                        logger.warning(f"TMDB API返回状态码: {response.status}")
        except Exception as e:
            logger.error(f"从TMDB获取集IMDB ID失败: {e}")
        
        return None
    
    async def _get_main_series_from_episode_imdb(self, episode_imdb_id: str) -> Optional[Dict[str, Any]]:
        """通过第一集的IMDB ID获取主系列信息"""
        return await self._get_main_series_from_episode_web(episode_imdb_id)
    
    async def _get_main_series_from_episode_web(self, episode_imdb_id: str) -> Optional[Dict[str, Any]]:
        """通过网页抓取方式从第一集的IMDB ID获取主系列信息"""
        try:
            import re
            import json
            episode_url = f"https://www.imdb.com/title/{episode_imdb_id}/"
            
            async with aiohttp.ClientSession() as session:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                }
                
                async with session.get(episode_url, headers=headers, timeout=10) as response:
                    if response.status == 200:
                        html = await response.text()
                        
                        next_data_pattern = r'<script[^>]*id="__NEXT_DATA__"[^>]*>({.+?})</script>'
                        next_data_match = re.search(next_data_pattern, html, re.DOTALL)
                        if next_data_match:
                            try:
                                next_data = json.loads(next_data_match.group(1))
                                props = next_data.get("props", {})
                                page_props = props.get("pageProps", {})
                                above_fold = page_props.get("aboveTheFoldData", {})
                                
                                series_obj = above_fold.get("series", {})
                                if series_obj:
                                    series_info = series_obj.get("series")
                                    if series_info:
                                        series_id = series_info.get("id")
                                        series_title_obj = series_info.get("titleText", {})
                                        series_title = series_title_obj.get("text") if series_title_obj else None
                                        release_year_obj = series_info.get("releaseYear", {})
                                        series_year = str(release_year_obj.get("year")) if release_year_obj and release_year_obj.get("year") else None
                                        
                                        if series_id and series_title:
                                            logger.info(f"从IMDB获取到主系列: {series_title} ({series_year}) [ID: {series_id}]")
                                            return {
                                                "main_series_imdb_id": series_id,
                                                "main_series_title": series_title,
                                                "main_series_year": series_year
                                            }
                                
                            except (json.JSONDecodeError, KeyError) as e:
                                logger.debug(f"解析__NEXT_DATA__失败: {e}")
            
            logger.warning(f"无法从IMDB网页获取主系列信息")
            return None
                    
        except Exception as e:
            logger.error(f"通过网页抓取获取主系列信息失败: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return None
    
    async def _search_imdb_id(self, title: str, year: Optional[str], media_type: str) -> Optional[str]:
        """通过IMDB非官方搜索API查找IMDB ID"""
        try:
            from urllib.parse import quote
            
            search_url = f"https://v3.sg.media-imdb.com/suggestion/x/{quote(title)}.json"
            
            async with aiohttp.ClientSession() as session:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Accept': 'application/json'
                }
                async with session.get(search_url, headers=headers) as response:
                    if response.status == 200:
                        data = await response.json()
                        suggestions = data.get("d", [])
                        
                        for item in suggestions:
                            item_title = item.get("l", "")
                            item_year = item.get("y")
                            item_id = item.get("id", "")
                            item_type = item.get("q", "")
                            
                            if media_type == "tv" and item_type not in ["TV series", "TV mini-series"]:
                                continue
                            elif media_type == "movie" and item_type != "feature":
                                continue
                            
                            if fuzz.ratio(title.lower(), item_title.lower()) > 80:
                                if year:
                                    if str(item_year) == str(year):
                                        return item_id
                                else:
                                    return item_id
        
        except Exception as e:
            logger.error(f"通过IMDB API搜索失败: {e}")
        
        return None
    
    async def search_trakt(
        self, 
        tmdb_info: Dict[str, Any],
        series_info: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """Trakt搜索入口"""
        try:
            title = tmdb_info.get("title") or tmdb_info.get("original_title")
            year = tmdb_info.get("year")
            media_type = tmdb_info.get("type", "tv")
            search_type = "show" if media_type == "tv" else "movie"
            
            tmdb_id = tmdb_info.get("tmdb_id")
            if tmdb_id:
                trakt_data = await self._search_trakt_by_tmdb_id(tmdb_id, search_type, tmdb_info, series_info)
                if trakt_data:
                    logger.info(f"通过TMDB ID在Trakt找到匹配: {trakt_data.get('title')}")
                    return trakt_data
            
            if series_info:
                main_title = series_info.get("main_title")
                if main_title:
                    trakt_data = await self._search_trakt_by_title(main_title, year, search_type, tmdb_info, series_info)
                    if trakt_data:
                        logger.info(f"通过主系列标题在Trakt找到匹配: {trakt_data.get('title')}")
                        return trakt_data
            
            trakt_data = await self._search_trakt_by_title(title, year, search_type, tmdb_info, series_info)
            if trakt_data:
                logger.info(f"通过标题在Trakt找到匹配: {trakt_data.get('title')}")
                return trakt_data
            
            logger.warning(f"在Trakt中未找到匹配: {title}")
            return None
            
        except Exception as e:
            logger.error(f"Trakt搜索失败: {e}")
            return None
    
    async def _search_trakt_by_tmdb_id(self, tmdb_id: int, media_type: str, tmdb_info: Dict[str, Any] = None, series_info: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """通过TMDB ID在Trakt搜索"""
        try:
            url = f"{TRAKT_BASE_URL}/search/tmdb/{tmdb_id}"
            params = {"type": media_type}
            headers = {
                "Content-Type": "application/json",
                "trakt-api-version": "2",
                "trakt-api-key": self.trakt_api_key
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, headers=headers) as response:
                    if response.status == 200:
                        results = await response.json()
                        if results:
                            item = results[0]
                            if media_type == "show":
                                show_data = item.get("show", {})
                                return await self._get_trakt_rating(show_data.get("ids", {}).get("slug"), media_type, tmdb_info, series_info)
                            else:
                                movie_data = item.get("movie", {})
                                return await self._get_trakt_rating(movie_data.get("ids", {}).get("slug"), media_type, tmdb_info, series_info)
        except Exception as e:
            logger.error(f"通过TMDB ID搜索Trakt失败: {e}")
        
        return None
    
    async def _search_trakt_by_title(self, title: str, year: Optional[str], media_type: str, tmdb_info: Dict[str, Any] = None, series_info: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """通过标题在Trakt搜索，使用模糊匹配找最佳结果"""
        try:
            from urllib.parse import quote
            
            url = f"{TRAKT_BASE_URL}/search/{media_type}"
            params = {"query": title}
            if year:
                params["years"] = year
            
            headers = {
                "Content-Type": "application/json",
                "trakt-api-version": "2",
                "trakt-api-key": self.trakt_api_key
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, headers=headers) as response:
                    if response.status == 200:
                        results = await response.json()
                        if results:
                            best_match = None
                            best_score = 0
                            
                            for item in results[:5]:
                                if media_type == "show":
                                    data = item.get("show", {})
                                else:
                                    data = item.get("movie", {})
                                
                                result_title = data.get("title", "")
                                result_year = data.get("year")
                                
                                title_score = fuzz.ratio(title.lower(), result_title.lower())
                                
                                if year and str(year) == str(result_year):
                                    title_score += 20
                                
                                if title_score > best_score:
                                    best_score = title_score
                                    best_match = data
                            
                            if best_match and best_score >= 60:
                                slug = best_match.get("ids", {}).get("slug")
                                return await self._get_trakt_rating(slug, media_type, tmdb_info, series_info)
        except Exception as e:
            logger.error(f"通过标题搜索Trakt失败: {e}")
        
        return None
    
    async def _get_trakt_rating(self, slug: str, media_type: str, tmdb_info: Dict[str, Any] = None, series_info: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """获取Trakt评分"""
        try:
            headers = {
                "Content-Type": "application/json",
                "trakt-api-version": "2",
                "trakt-api-key": self.trakt_api_key
            }
            
            async with aiohttp.ClientSession() as session:
                url = f"{TRAKT_BASE_URL}/{media_type}s/{slug}/ratings"
                async with session.get(url, headers=headers) as response:
                    if response.status != 200:
                        logger.error(f"获取Trakt整体评分失败: HTTP {response.status}")
                        return None
                    
                    overall_data = await response.json()
                    result = {
                        "rating": overall_data.get("rating", "暂无"),
                        "votes": overall_data.get("votes", "暂无"),
                        "distribution": overall_data.get("distribution", {}),
                        "slug": slug,
                        "url": f"https://trakt.tv/{media_type}s/{slug}"
                    }
                    
                    if media_type == "show":
                        is_anthology = series_info is not None
                        tmdb_seasons = tmdb_info.get("number_of_seasons", 0) if tmdb_info else 0
                        
                        if is_anthology or tmdb_seasons == 1:
                            show_type = "选集剧" if is_anthology else "单季剧"
                            logger.info(f"[{show_type}] 获取整体评分 + 第1季评分")
                            season_rating = await self._get_single_season_rating(slug, 1, session, headers)
                            if season_rating:
                                result["seasons"] = [season_rating]
                                logger.info(f"[{show_type}] 成功获取第1季评分: {season_rating['rating']}/10")
                            else:
                                logger.warning(f"[{show_type}] 未能获取第1季评分，使用整体评分作为兜底")
                                result["seasons"] = [{
                                    "season_number": 1,
                                    "rating": result["rating"],
                                    "votes": result["votes"],
                                    "distribution": result["distribution"]
                                }]
                        
                        else:
                            logger.info(f"[多季剧] 获取整体评分 + 所有季评分")
                            seasons_ratings = await self._get_trakt_seasons_ratings(slug, session, headers)
                            if seasons_ratings:
                                result["seasons"] = seasons_ratings
                                logger.info(f"[多季剧] 成功获取 {len(seasons_ratings)} 季的评分")
                            else:
                                logger.warning(f"[多季剧] 未能获取分季评分，尝试只获取第1季")
                                season_rating = await self._get_single_season_rating(slug, 1, session, headers)
                                if season_rating:
                                    result["seasons"] = [season_rating]
                                    logger.info(f"[多季剧] 兜底成功：获取到第1季评分")
                                else:
                                    logger.warning(f"[多季剧] 完全失败，无法获取任何分季评分")
                    
                    return result
                    
        except Exception as e:
            logger.error(f"获取Trakt评分失败: {e}")
        
        return None
    
    async def _get_single_season_rating(
        self, 
        slug: str, 
        season_number: int,
        session: aiohttp.ClientSession,
        headers: Dict[str, str]
    ) -> Optional[Dict[str, Any]]:
        """获取单个季的评分"""
        try:
            season_rating_url = f"{TRAKT_BASE_URL}/shows/{slug}/seasons/{season_number}/ratings"
            logger.info(f"请求第 {season_number} 季评分: {season_rating_url}")
            
            async with session.get(season_rating_url, headers=headers) as response:
                logger.info(f"响应状态码: {response.status}")
                
                if response.status == 200:
                    rating_data = await response.json()
                    logger.info(f"成功获取第 {season_number} 季评分: {rating_data.get('rating')}/10 ({rating_data.get('votes')} 票)")
                    return {
                        "season_number": season_number,
                        "rating": rating_data.get("rating", 0),
                        "votes": rating_data.get("votes", 0),
                        "distribution": rating_data.get("distribution", {})
                    }
                else:
                    logger.warning(f"获取第 {season_number} 季评分失败: HTTP {response.status}")
                    response_text = await response.text()
                    logger.debug(f"响应内容: {response_text[:200]}")
                    
        except Exception as e:
            logger.error(f"获取第 {season_number} 季评分异常: {e}")
            import traceback
            logger.debug(traceback.format_exc())
        
        return None
    
    async def _get_trakt_seasons_ratings(self, slug: str, session: aiohttp.ClientSession, headers: Dict[str, str]) -> Optional[List[Dict[str, Any]]]:
        """获取剧集所有季的评分"""
        try:
            seasons_url = f"{TRAKT_BASE_URL}/shows/{slug}/seasons?extended=episodes"
            async with session.get(seasons_url, headers=headers) as response:
                if response.status != 200:
                    logger.error(f"获取剧集季信息失败: HTTP {response.status}")
                    return None
                
                seasons_info = await response.json()
                
                regular_seasons = [s for s in seasons_info if s.get("number", 0) > 0]
                
                if not regular_seasons:
                    logger.warning(f"剧集 {slug} 没有常规季")
                    return None
                
                logger.info(f"找到 {len(regular_seasons)} 个常规季")
                
                seasons_ratings = []
                for season in regular_seasons:
                    season_number = season.get("number")
                    if season_number is None or season_number == 0:
                        continue
                    
                    season_rating_url = f"{TRAKT_BASE_URL}/shows/{slug}/seasons/{season_number}/ratings"
                    try:
                        async with session.get(season_rating_url, headers=headers) as rating_response:
                            if rating_response.status == 200:
                                rating_data = await rating_response.json()
                                seasons_ratings.append({
                                    "season_number": season_number,
                                    "rating": rating_data.get("rating", 0),
                                    "votes": rating_data.get("votes", 0),
                                    "distribution": rating_data.get("distribution", {})
                                })
                                logger.info(f"  第 {season_number} 季: {rating_data.get('rating', 0)}/10 ({rating_data.get('votes', 0)} 票)")
                            else:
                                logger.warning(f"  第 {season_number} 季评分获取失败: HTTP {rating_response.status}")
                    except Exception as e:
                        logger.error(f"  获取第 {season_number} 季评分失败: {e}")
                        continue
                
                return seasons_ratings if seasons_ratings else None
                
        except Exception as e:
            logger.error(f"获取分季评分失败: {e}")
            return None
    
    def generate_search_variants(self, tmdb_info: Dict[str, Any], series_info: Optional[Dict[str, Any]] = None) -> List[Dict[str, str]]:
        """生成多策略搜索变体"""
        variants = []
        
        title = tmdb_info.get("title", "")
        original_title = tmdb_info.get("original_title", "")
        year = tmdb_info.get("year", "")
        
        subtitle = self.extract_subtitle_from_title(title)
        if subtitle and series_info:
            variants.append({
                "title": subtitle,
                "year": year,
                "type": "subtitle_for_rt",
                "strategy": "subtitle_only",
                "priority": 1,
                "for_rottentomatoes": True
            })
        
        if title:
            variants.append({
                "title": title,
                "year": year,
                "type": "full_title",
                "strategy": "standalone",
                "priority": 2 if (subtitle and series_info) else 1
            })
        
        if original_title and original_title != title:
            variants.append({
                "title": original_title,
                "year": year,
                "type": "full_original_title",
                "strategy": "standalone",
                "priority": 2 if (subtitle and series_info) else 1
            })
        
        if series_info:
            main_title = series_info.get("main_title")
            if main_title:
                subtitle_hint = self.extract_subtitle_from_title(tmdb_info.get("title", ""))
                
                variants.append({
                    "title": main_title,
                    "year": "",
                    "type": "main_series_no_year",
                    "strategy": "anthology_series",
                    "priority": 2,
                    "subtitle_hint": subtitle_hint,
                    "match_by_subtitle": True
                })
                
                if year:
                    variants.append({
                        "title": main_title,
                        "year": year,
                        "type": "main_series_with_year",
                        "strategy": "anthology_series",
                        "priority": 3,
                        "subtitle_hint": subtitle_hint
                    })
        else:
            for pattern in ANTHOLOGY_TITLE_PATTERNS:
                match = re.match(pattern, title, re.IGNORECASE)
                if match:
                    main_title = match.group(1).strip()
                    variants.append({
                        "title": main_title,
                        "year": year,
                        "type": "extracted_main_title",
                        "strategy": "anthology_series",
                        "priority": 2
                    })
                    break
        
        title_without_year = re.sub(r'\s*\(\d{4}\)\s*$', '', title)
        if title_without_year != title:
            variants.append({
                "title": title_without_year,
                "year": year,
                "type": "title_without_year",
                "strategy": "standalone",
                "priority": 1
            })
        
        unique_variants = []
        seen = set()
        for variant in variants:
            key = f"{variant['title'].lower()}_{variant['year']}"
            if key not in seen:
                seen.add(key)
                unique_variants.append(variant)
        
        unique_variants.sort(key=lambda x: x['priority'])
        
        logger.info(f"生成了 {len(unique_variants)} 个搜索标题变体")
        for i, v in enumerate(unique_variants, 1):
            logger.info(f"  {i}. {v['title']} ({v['year']}) [策略:{v['strategy']}, 类型:{v['type']}]")
        
        return unique_variants

anthology_handler = AnthologyHandler()
