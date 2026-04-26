# ==========================================
# 榜单抓取与调度核心模块
# ==========================================
import asyncio
import os
import re
import time
import logging
import aiohttp
import httpx
import requests
import json
from urllib.parse import quote
from typing import List, Dict, Optional, TYPE_CHECKING
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from sqlalchemy.orm import Session

from browser_pool import browser_pool, wait_turn
from models import ChartEntry, SessionLocal

_TZ_SHANGHAI = ZoneInfo("Asia/Shanghai")

if TYPE_CHECKING:
    from starlette.requests import Request

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TMDB_API_KEY = os.getenv("TMDB_API_KEY", "")
TMDB_TOKEN = os.getenv("TMDB_TOKEN", "")
TMDB_API_BASE_URL = os.getenv("TMDB_API_BASE_URL", "").rstrip("/")
TRAKT_CLIENT_ID = os.getenv("TRAKT_CLIENT_ID", "")
TRAKT_BASE_URL = os.getenv("TRAKT_BASE_URL", "").rstrip("/")

try:
    import schedule
    SCHEDULE_AVAILABLE = True
except ImportError:
    SCHEDULE_AVAILABLE = False
    logger.warning("schedule库未安装，定时任务功能将不可用")

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False
    logger.warning("requests库未安装，TMDB API调用功能将不可用")

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

async def _letterboxd_flaresolverr(url: str) -> Optional[Dict]:
    """调用 FlareSolverr"""
    fs_url = os.environ.get("FLARESOLVERR_URL", "").strip()
    if not fs_url:
        return None
    if not fs_url.endswith("/v1"):
        fs_url = fs_url.rstrip("/") + "/v1"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                fs_url,
                json={"cmd": "request.get", "url": url, "maxTimeout": 120000},
                timeout=aiohttp.ClientTimeout(total=135),
            ) as resp:
                data = await resp.json()
        if data.get("status") != "ok" or not data.get("solution"):
            msg = data.get("message") or data.get("error") or "unknown"
            logger.warning(f"Letterboxd FlareSolverr 返回异常: status={data.get('status')}, message={msg}")
            return None
        sol = data["solution"]
        cookies = sol.get("cookies") or []
        ua = sol.get("userAgent") or ""
        if not cookies or not ua:
            return None
        pw = [
            {"name": c.get("name"), "value": c.get("value"), "domain": c.get("domain", ".letterboxd.com"), "path": c.get("path", "/")}
            for c in cookies
            if c.get("name") and c.get("value")
        ]
        if not pw:
            return None
        return {"cookies": pw, "userAgent": ua}
    except Exception as e:
        logger.warning(f"Letterboxd FlareSolverr 请求失败: {type(e).__name__}: {e}")
        return None

def _parse_letterboxd_cookie_string(s: str) -> list:
    """解析 .env 中的 LETTERBOXD_COOKIE"""
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

class ChartScraper:
    def __init__(self, db: Session):
        self.db = db
    
    @staticmethod
    def _safe_get_title(info: Dict, fallback_title: str = '') -> str:
        """安全获取标题"""
        zh_title = (info.get('zh_title') or '').strip()
        tmdb_title = (info.get('title') or '').strip()
        tmdb_name = (info.get('name') or '').strip()
        return zh_title or tmdb_title or tmdb_name or fallback_title

    def _get_existing_ranks(self, platform: str, chart_name: str) -> set:
        """读取当前榜单已入库的 rank 集合"""
        try:
            rows = (
                self.db.query(ChartEntry.rank)
                .filter(
                    ChartEntry.platform == platform,
                    ChartEntry.chart_name == chart_name,
                )
                .all()
            )
            return {r[0] for r in rows if r and r[0] is not None}
        except Exception:
            return set()

    def _upsert_chart_entry_by_rank(
        self,
        *,
        platform: str,
        chart_name: str,
        rank: int,
        media_type: str,
        tmdb_id: int,
        title: str,
        poster: str,
    ) -> None:
        try:
            existing = (
                self.db.query(ChartEntry)
                .filter(
                    ChartEntry.platform == platform,
                    ChartEntry.chart_name == chart_name,
                    ChartEntry.rank == rank,
                )
                .first()
            )
            if existing and getattr(existing, "locked", False):
                return
            self.db.query(ChartEntry).filter(
                ChartEntry.platform == platform,
                ChartEntry.chart_name == chart_name,
                ChartEntry.rank == rank,
            ).delete()
        except Exception:
            try:
                self.db.query(ChartEntry).filter(
                    ChartEntry.platform == platform,
                    ChartEntry.chart_name == chart_name,
                    ChartEntry.rank == rank,
                ).delete()
            except Exception:
                pass
        self.db.add(
            ChartEntry(
                platform=platform,
                chart_name=chart_name,
                media_type=media_type,
                rank=rank,
                tmdb_id=tmdb_id,
                title=title,
                poster=poster,
            )
        )

    def _replace_chart_snapshot(self, platform: str, chart_name: str, entries: list[dict]) -> int:
        try:
            logger.info(f"{platform} {chart_name}: 准备替换快照，待写入 entries={len(entries)}")
            locked_rows = (
                self.db.query(ChartEntry)
                .filter(
                    ChartEntry.platform == platform,
                    ChartEntry.chart_name == chart_name,
                    ChartEntry.locked == True,
                )
                .all()
            )
            locked_keys = {(r.media_type, int(r.rank)) for r in locked_rows if r.rank is not None}
            logger.info(f"{platform} {chart_name}: 检测到锁定条目 {len(locked_keys)} 条")

            deleted_count = self.db.query(ChartEntry).filter(
                ChartEntry.platform == platform,
                ChartEntry.chart_name == chart_name,
                ChartEntry.locked == False,
            ).delete(synchronize_session=False)
            logger.info(f"{platform} {chart_name}: 已删除未锁定旧条目 {deleted_count} 条")

            inserted_count = 0
            skipped_locked = 0
            for e in entries:
                try:
                    mt = e["media_type"]
                    rk = int(e["rank"])
                except Exception:
                    continue
                if (mt, rk) in locked_keys:
                    skipped_locked += 1
                    continue
                self.db.add(
                    ChartEntry(
                        platform=platform,
                        chart_name=chart_name,
                        media_type=mt,
                        rank=rk,
                        tmdb_id=int(e["tmdb_id"]),
                        title=e.get("title") or "",
                        poster=e.get("poster") or "",
                    )
                )
                inserted_count += 1

            self.db.commit()
            logger.info(
                f"{platform} {chart_name}: 快照替换完成，写入 {inserted_count} 条，因锁定跳过 {skipped_locked} 条"
            )
            return len(entries)
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
            raise

    async def scrape_douban_weekly_movie_chart(self) -> List[Dict]:
        """豆瓣 一周口碑榜"""
        async def scrape_with_browser(browser):
            page = await browser.new_page()
            try:
                await page.goto("https://movie.douban.com/", wait_until="domcontentloaded")
                await asyncio.sleep(3)
                
                await page.wait_for_load_state("networkidle")
                
                await asyncio.sleep(3)
                
                try:
                    await page.wait_for_selector('#billboard .billboard-bd table tr', timeout=10000)
                except:
                    pass
                
                chart_items = await page.query_selector_all('#billboard .billboard-bd table tbody tr')
                results = []
                
                if not chart_items:
                    await asyncio.sleep(2)
                    chart_items = await page.query_selector_all('#billboard .billboard-bd table tr')
                
                logger.info("使用CSS选择器获取豆瓣一周口碑榜数据...")
                logger.info(f"找到 {len(chart_items)} 个表格行")
                for i, item in enumerate(chart_items, 1):
                    try:
                        title_elem = await item.query_selector('.title a')
                        if title_elem:
                            title = await title_elem.inner_text()
                            url = await title_elem.get_attribute('href')
                            douban_id = re.search(r'/subject/(\d+)/', url)
                            if douban_id and title.strip():
                                results.append({
                                    'rank': i,
                                    'title': title.strip(),
                                    'douban_id': douban_id.group(1),
                                    'url': url
                                })
                                logger.info(f"获取到第{i}项: {title.strip()} (ID: {douban_id.group(1)})")
                    except Exception as e:
                        logger.error(f"处理豆瓣电影榜单项时出错: {e}")
                        continue
                
                if not results:
                    for i, item in enumerate(chart_items[1:], 1):
                        try:
                            title_elem = await item.query_selector('.title a')
                            if title_elem:
                                title = await title_elem.inner_text()
                                url = await title_elem.get_attribute('href')
                                douban_id = re.search(r'/subject/(\d+)/', url)
                                if douban_id and title.strip():
                                    results.append({
                                        'rank': i,
                                        'title': title.strip(),
                                        'douban_id': douban_id.group(1),
                                        'url': url
                                    })
                        except Exception as e:
                            logger.error(f"处理豆瓣 一周口碑榜 榜单项时出错: {e}")
                            continue
                
                logger.info(f"豆瓣 一周口碑榜获取到 {len(results)} 个项目")
                return results
            finally:
                await page.close()
                
        return await browser_pool.execute_in_browser(scrape_with_browser)

    async def scrape_douban_weekly_global_tv_chart(self) -> List[Dict]:
        """豆瓣 一周全球剧集口碑榜"""
        try:
            import json

            api_url = (
                "https://m.douban.com/rexxar/api/v2/subject_collection/"
                "tv_global_best_weekly/items?start=0&count=10&updated_at=&items_only=1&type_tag=&ck=kpTM&for_mobile=1"
            )
            headers = {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) '
                              'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
                'Referer': 'https://m.douban.com/subject_collection/tv_global_best_weekly',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
            }

            wait_turn()
            resp = requests.get(api_url, headers=headers, timeout=20, verify=True)
            if resp.status_code != 200:
                logger.error(f"豆瓣 一周全球剧集口碑榜 API 调用失败，状态码: {resp.status_code}")
                return []

            try:
                data = resp.json()
            except Exception:
                data = json.loads(resp.text)

            if isinstance(data, dict) and 'subject_collection_items' in data:
                items = data['subject_collection_items']
            elif isinstance(data, list):
                items = data
            else:
                logger.error(f"豆瓣 一周全球剧集口碑榜 API 返回格式异常: {type(data)}")
                return []

            results: List[Dict] = []
            for item in items:
                douban_id = item.get('id') or ''
                if not douban_id:
                    uri = item.get('uri') or ''
                    if '/subject/' in uri:
                        douban_id = uri.split('/subject/')[-1].split('/')[0]
                results.append({
                    'rank': item.get('rank', 0),
                    'title': item.get('title', ''),
                    'douban_id': str(douban_id),
                    'url': f"https://movie.douban.com/subject/{douban_id}/" if douban_id else ''
                })

            logger.info(f"豆瓣 一周全球剧集口碑榜 获取到 {len(results)} 个项目")
            if results:
                logger.debug(f"示例: {results[0]}")
            return results
        except Exception as e:
            logger.error(f"抓取豆瓣 一周全球剧集口碑榜 失败: {e}")
            return []

    async def get_douban_imdb_id(self, douban_id: str) -> Optional[str]:
        """从豆瓣详情页获取IMDb ID"""
        try:
            import requests
            import urllib3
            from bs4 import BeautifulSoup
            
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            
            url = f"https://movie.douban.com/subject/{douban_id}/"
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
            
            response = requests.get(url, headers=headers, verify=False)
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                
                imdb_links = soup.find_all('a', href=lambda x: x and 'imdb.com' in x)
                for link in imdb_links:
                    href = link.get('href', '')
                    if '/title/tt' in href:
                        imdb_id = href.split('/title/')[-1].rstrip('/')
                        if imdb_id.startswith('tt'):
                            logger.info(f"从豆瓣详情页获取到IMDb ID: {imdb_id}")
                            return imdb_id
                
                imdb_spans = soup.find_all('span', class_='pl')
                for span in imdb_spans:
                    if span.get_text().strip() == 'IMDb:':
                        sibling_text = getattr(span.next_sibling, 'strip', lambda: str(span.next_sibling))()
                        if sibling_text:
                            import re as _re
                            m = _re.search(r'(tt\d+)', sibling_text)
                            if m:
                                imdb_text = m.group(1)
                                logger.info(f"从豆瓣详情页文本兄弟节点获取到IMDb ID: {imdb_text}")
                                return imdb_text

                        next_span = span.find_next_sibling('span')
                        if next_span:
                            imdb_text = next_span.get_text().strip()
                            if imdb_text.startswith('tt'):
                                logger.info(f"从豆瓣详情页相邻span中获取到IMDb ID: {imdb_text}")
                                return imdb_text

                        import re as _re2
                        m2 = _re2.search(r'<span class="pl">IMDb:</span>\s*([tT]{2}\d+)<br>', response.text)
                        if m2:
                            imdb_text = m2.group(1)
                            logger.info(f"从豆瓣详情页HTML中获取到IMDb ID: {imdb_text}")
                            return imdb_text
                
                        logger.warning(f"豆瓣详情页 {url} 中未找到IMDb ID")
                        return None
            else:
                logger.error(f"访问豆瓣详情页失败，状态码: {response.status_code}")
                return None
        except Exception as e:
            logger.error(f"获取豆瓣IMDb ID失败: {e}")
            return None

    async def scrape_douban_weekly_chinese_tv_chart(self) -> List[Dict]:
        """豆瓣 一周华语剧集口碑榜"""
        try:
            import json

            api_url = (
                "https://m.douban.com/rexxar/api/v2/subject_collection/"
                "tv_chinese_best_weekly/items?start=0&count=10&updated_at=&items_only=1&type_tag=&ck=kpTM&for_mobile=1"
            )
            headers = {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) '
                              'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
                'Referer': 'https://m.douban.com/subject_collection/tv_chinese_best_weekly',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
            }

            wait_turn()
            resp = requests.get(api_url, headers=headers, timeout=20, verify=True)
            if resp.status_code != 200:
                logger.error(f"豆瓣 一周华语剧集口碑榜 API 调用失败，状态码: {resp.status_code}")
                return []

            try:
                data = resp.json()
            except Exception:
                data = json.loads(resp.text)

            if isinstance(data, dict) and 'subject_collection_items' in data:
                items = data['subject_collection_items']
            elif isinstance(data, list):
                items = data
            else:
                logger.error(f"豆瓣 一周华语剧集口碑榜 API 返回格式异常: {type(data)}")
                return []

            results: List[Dict] = []
            for item in items:
                douban_id = item.get('id') or ''
                if not douban_id:
                    uri = item.get('uri') or ''
                    if '/subject/' in uri:
                        douban_id = uri.split('/subject/')[-1].split('/')[0]
                results.append({
                    'rank': item.get('rank', 0),
                    'title': item.get('title', ''),
                    'douban_id': str(douban_id),
                    'url': f"https://movie.douban.com/subject/{douban_id}/" if douban_id else ''
                })

            logger.info(f"豆瓣 一周华语剧集口碑榜 获取到 {len(results)} 个项目")
            if results:
                logger.debug(f"示例: {results[0]}")
            return results
        except Exception as e:
            logger.error(f"抓取 豆瓣 一周华语剧集口碑榜 失败: {e}")
            return []

    async def scrape_imdb_top_10(self) -> List[Dict]:
        """IMDb 本周 Top 10"""
        try:
            logger.info("开始爬取 IMDb 本周 Top 10 榜单")
            
            import requests
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            
            api_url = "https://api.graphql.imdb.com/"
            today = datetime.now(_TZ_SHANGHAI).strftime("%Y-%m-%d")
            
            variables_dict = {
                "fanPicksFirst": 30, "first": 30, "locale": "zh-CN",
                "placement": "home", "today": today, "topPicksFirst": 30, "topTenFirst": 10
            }
            variables_json = json.dumps(variables_dict, separators=(",", ":"))
            variables_encoded = quote(variables_json)
            extensions_json = '{"persistedQuery":{"sha256Hash":"51f4fbaaf115fd73779d9f31b267e432d40e9eb96a0b49293507a4da4c6b30ce","version":1}}'
            extensions_encoded = quote(extensions_json)
            api_url = f"https://api.graphql.imdb.com/?operationName=BatchPage_HomeMain&variables={variables_encoded}&extensions={extensions_encoded}"

            imdb_cookie = (os.getenv("IMDB_GRAPHQL_COOKIE") or "").strip()
            if not imdb_cookie:
                logger.warning("未配置 IMDB_GRAPHQL_COOKIE，跳过 IMDb 本周 Top 10 抓取（请在 .env 中设置浏览器 Cookie）")
                return []

            imdb_client_rid = (os.getenv("IMDB_CLIENT_RID") or "").strip()
            imdb_amazon_session = (os.getenv("IMDB_AMAZON_SESSION_ID") or "").strip()
            imdb_consent = (os.getenv("IMDB_CONSENT_INFO") or "eyJhZ2VTaWduYWwiOiJBRFVMVCIsImlzR2RwciI6ZmFsc2V9").strip()
            imdb_ua = (os.getenv("IMDB_GRAPHQL_USER_AGENT") or "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36").strip()

            headers = {
                'accept': 'application/graphql+json, application/json',
                'accept-encoding': 'gzip, deflate',
                'accept-language': 'zh-CN,zh;q=0.9',
                'content-type': 'application/json',
                'cookie': imdb_cookie,
                'origin': 'https://www.imdb.com',
                'priority': 'u=1, i',
                'referer': 'https://www.imdb.com/',
                'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"macOS"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-site',
                'user-agent': imdb_ua,
                'x-imdb-client-name': 'imdb-web-next',
                'x-imdb-user-country': 'CN',
                'x-imdb-user-language': 'zh-CN',
                'x-imdb-weblab-treatment-overrides': '{"IMDB_DISCO_KNOWNFOR_V2_1328450":"T1","IMDB_SEARCH_DISCOVER_MODERN_1367402":"T1"}',
                'x-imdb-consent-info': imdb_consent,
            }
            if imdb_amazon_session:
                headers['x-amzn-sessionid'] = imdb_amazon_session
            if imdb_client_rid:
                headers['x-imdb-client-rid'] = imdb_client_rid

            session = requests.Session()
            session.headers.update(headers)

            response = session.get(api_url, timeout=30, verify=False)
            logger.info(f"IMDb API响应状态: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                results = []
                top_edges = (data.get("data", {}).get("topMeterTitles", {}) or {}).get("edges", [])
                if not top_edges:
                    batch_list = data.get("data", {}).get("batch", {}).get("responseList", [])
                    for item in batch_list:
                        inner_data = item.get("data", {})
                        top_edges = inner_data.get("topMeterTitles", {}).get("edges", [])
                        for edge in top_edges:
                            node = edge.get("node", {})
                            imdb_id = node.get("id")
                            rank = (node.get("meterRanking", {}) or {}).get("currentRank")
                            title = ((node.get("titleText") or {}).get("text")) or ""
                            if imdb_id and isinstance(rank, int) and rank >= 1:
                                results.append({
                                    "rank": rank,
                                    "title": title,
                                    "imdb_id": imdb_id,
                                    "url": f"https://www.imdb.com/title/{imdb_id}/"
                                })
                else:
                    for edge in top_edges:
                        node = edge.get("node", {})
                        imdb_id = node.get("id")
                        rank = (node.get("meterRanking", {}) or {}).get("currentRank")
                        title = ((node.get("titleText") or {}).get("text")) or ""
                        if imdb_id and isinstance(rank, int) and rank >= 1:
                            results.append({
                                "rank": rank,
                                "title": title,
                                "imdb_id": imdb_id,
                                "url": f"https://www.imdb.com/title/{imdb_id}/"
                            })

                results.sort(key=lambda x: x["rank"])
                results = results[:10]

                logger.info(f"IMDb 本周 Top 10 获取到 {len(results)} 条（GraphQL）")
                return results
            else:
                logger.error(f"IMDB API请求失败: {response.status_code}")
                error_text = response.text
                logger.error(f"错误响应: {error_text[:500]}")
                return []
                        
        except Exception as e:
            logger.error(f"爬取 IMDb 本周 Top 10 榜单失败: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return []

    async def scrape_letterboxd_popular(self) -> List[Dict]:
        """Letterboxd 本周热门影视"""
        films_url = "https://letterboxd.com/films/"
        async def scrape_with_browser(browser):
            ctx_to_close = None
            page = await browser.new_page()
            try:
                logger.info(f"Letterboxd 本周热门影视: 开始抓取 {films_url}")
                letterboxd_cookie = os.environ.get("LETTERBOXD_COOKIE", "").strip()
                if letterboxd_cookie:
                    cookies = _parse_letterboxd_cookie_string(letterboxd_cookie)
                    if cookies:
                        await page.context.add_cookies(cookies)
                        logger.info("Letterboxd 本周热门影视: 已注入 LETTERBOXD_COOKIE")
                await page.goto(films_url, wait_until="domcontentloaded")
                await asyncio.sleep(2)
                if await _is_cloudflare_challenge(page):
                    logger.warning("Letterboxd 本周热门影视: 检测到 Cloudflare 验证，尝试 FlareSolverr…")
                    if not os.environ.get("FLARESOLVERR_URL", "").strip():
                        logger.warning("Letterboxd 本周热门影视: 未配置 FLARESOLVERR_URL")
                    fs = await _letterboxd_flaresolverr(films_url)
                    if not fs:
                        logger.warning("Letterboxd 本周热门影视: 未配置或 FlareSolverr 失败，返回空")
                        return []
                    logger.info(
                        f"Letterboxd 本周热门影视: FlareSolverr 成功返回 cookies={len(fs.get('cookies', []))} ua_len={len(fs.get('userAgent', ''))}"
                    )
                    await page.close()
                    ctx_to_close = await browser.new_context(viewport={"width": 1280, "height": 720}, user_agent=fs["userAgent"])
                    await ctx_to_close.add_cookies(fs["cookies"])
                    page = await ctx_to_close.new_page()
                    await page.goto(films_url, wait_until="domcontentloaded", timeout=15000)
                    await asyncio.sleep(2)
                    if await _is_cloudflare_challenge(page):
                        logger.warning("Letterboxd 本周热门影视: FlareSolverr 后仍为 CF，返回空")
                        return []
                popular_items = await page.query_selector_all('#popular-films .poster-list li')
                logger.info(f"Letterboxd 本周热门影视: 选择器命中 {len(popular_items)} 项")
                if not popular_items:
                    logger.warning("Letterboxd 本周热门影视: 未命中榜单节点，可能是页面结构变化或仍被拦截")
                results = []
                missing_title_count = 0
                missing_link_count = 0
                missing_film_id_count = 0
                
                for i, item in enumerate(popular_items[:10], 1):
                    try:
                        title_elem = await item.query_selector('[data-item-name]')
                        title = ""
                        link = ""
                        film_id = ""
                        if title_elem:
                            title = (await title_elem.get_attribute('data-item-name') or "").strip()
                            link = (await title_elem.get_attribute('data-item-link') or "").strip()
                            film_id = (await title_elem.get_attribute('data-film-id') or "").strip()

                        if not title:
                            title = (await item.get_attribute('data-item-name') or "").strip()
                        if not link:
                            link = (await item.get_attribute('data-item-link') or "").strip()
                        if not film_id:
                            film_id = (await item.get_attribute('data-film-id') or "").strip()

                        if not title:
                            img = await item.query_selector('img[alt]')
                            if img:
                                title = (await img.get_attribute('alt') or "").strip()
                        if not link:
                            anchor = await item.query_selector('a[href*="/film/"]')
                            if anchor:
                                link = (await anchor.get_attribute('href') or "").strip()

                        if title and link:
                            if not link.startswith("http"):
                                if not link.startswith("/"):
                                    link = "/" + link
                                full_url = f"https://letterboxd.com{link}"
                            else:
                                full_url = link
                            if not film_id:
                                missing_film_id_count += 1
                            results.append({
                                'rank': i,
                                'title': title,
                                'letterboxd_id': film_id,
                                'url': full_url
                            })
                        else:
                            if not title:
                                missing_title_count += 1
                            if not link:
                                missing_link_count += 1
                    except Exception as e:
                        logger.error(f"处理 Letterboxd 本周热门影视 榜单项时出错: {e}")
                        continue
                logger.info(f"Letterboxd 本周热门影视: 抓取解析完成，结果 {len(results)} 条")
                logger.info(
                    f"Letterboxd 本周热门影视: 字段缺失统计 missing_title={missing_title_count}, "
                    f"missing_link={missing_link_count}, missing_film_id={missing_film_id_count}"
                )
                if results:
                    logger.info(f"Letterboxd 本周热门影视: 示例首条 title={results[0].get('title','')} rank={results[0].get('rank')}")
                        
                return results
            finally:
                if ctx_to_close:
                    await ctx_to_close.close()
                else:
                    await page.close()
                
        return await browser_pool.execute_in_browser(scrape_with_browser)

    async def _rt_extract_itemlist(self, url: str, item_type: str) -> List[Dict]:
        """使用浏览器读取 JSON-LD ItemList"""
        async def scrape(browser):
            page = await browser.new_page()
            try:
                page.set_default_timeout(120000)
                await page.goto(url, wait_until="domcontentloaded", timeout=120000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=3000)
                except Exception:
                    pass
                await asyncio.sleep(0.2)
                
                handles = await page.query_selector_all('script[type="application/ld+json"]')
                for h in handles:
                    raw = await h.inner_text()
                    if not raw:
                        continue
                    data = None
                    try:
                        data = json.loads(raw)
                    except Exception:
                        m = re.search(r'\{\s*"@context"\s*:\s*"http://schema.org"[\s\S]*?\}', raw)
                        if m:
                            try:
                                data = json.loads(m.group(0))
                            except Exception:
                                data = None
                    if data is None:
                        continue
                    candidates = data if isinstance(data, list) else [data]
                    for obj in candidates:
                        if not isinstance(obj, dict):
                            continue
                        if obj.get('@type') == 'ItemList' and obj.get('itemListElement'):
                            inner = obj.get('itemListElement')
                            if isinstance(inner, dict) and inner.get('@type') == 'ItemList':
                                elements = inner.get('itemListElement') or []
                            else:
                                elements = inner or []
                            parsed = []
                            for it in elements:
                                node = it.get('item') if isinstance(it, dict) and 'item' in it else it
                                if not isinstance(node, dict) or node.get('@type') != item_type:
                                    continue
                                name = node.get('name') or ''
                                year = None
                                dc = node.get('dateCreated')
                                if isinstance(dc, str):
                                    y = dc[:4]
                                    if re.match(r'^\d{4}$', y):
                                        try:
                                            year = int(y)
                                        except Exception:
                                            year = None
                                pos = it.get('position') if isinstance(it, dict) else None
                                if pos is None:
                                    pos = node.get('position')
                                try:
                                    position = int(pos) if pos is not None else None
                                except Exception:
                                    position = None
                                parsed.append({'position': position, 'name': name, 'year': year, 'url': node.get('url')})
                            if parsed:
                                parsed.sort(key=lambda x: x.get('position') or 9999)
                                return parsed
                return []
            finally:
                await page.close()
        import json
        return await browser_pool.execute_in_browser(scrape)

    async def update_rotten_movies(self) -> int:
        """Rotten Tomatoes 本周热门流媒体电影"""
        platform = 'Rotten Tomatoes'
        chart_name = '本周热门流媒体电影'
        
        matcher = TMDBMatcher(self.db)
        url = 'https://www.rottentomatoes.com/browse/movies_at_home/sort:popular'
        max_retries = 3
        for attempt in range(max_retries):
            try:
                logger.info(f"Rotten Tomatoes 本周热门流媒体电影 榜单抓取尝试 {attempt + 1}/{max_retries}")
                items = await self._rt_extract_itemlist(url, 'Movie')
                if not items:
                    raise Exception("未获取到 Rotten Tomatoes 本周热门流媒体电影 榜单数据")
                break
            except Exception as e:
                logger.warning(f"Rotten Tomatoes 本周热门流媒体电影 抓取失败 (尝试 {attempt + 1}/{max_retries}): {e}")
                if attempt == max_retries - 1:
                    logger.error("Rotten Tomatoes 本周热门流媒体电影 抓取最终失败")
                    return 0
                await asyncio.sleep(5 * (attempt + 1))
        
        entries: list[dict] = []
        rank = 1
        for it in items[:10]:
            title = it.get('name') or ''
            year = it.get('year')
            match = None
            for attempt in range(3):
                try:
                    tmdb_id = await matcher.match_by_title_and_year(title, 'movie', str(year) if year else None)
                    if not tmdb_id:
                        raise RuntimeError('no tmdb')
                    info = await matcher.get_tmdb_info(tmdb_id, 'movie')
                    if not info:
                        raise RuntimeError('no info')
                    match = {
                        'tmdb_id': tmdb_id,
                        'title': self._safe_get_title(info, title),
                        'poster': info.get('poster_url', ''),
                        'media_type': 'movie'
                    }
                    break
                except Exception:
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)
            if not match:
                logger.warning(f"Rotten Tomatoes 本周热门流媒体电影 未匹配: {title}")
                rank += 1
                continue
            
            final_title = match.get('title') or title or f"TMDB-{match['tmdb_id']}"
            entries.append(
                {
                    "media_type": match.get("media_type", "movie"),
                    "rank": rank,
                    "tmdb_id": match["tmdb_id"],
                    "title": final_title,
                    "poster": match.get("poster", ""),
                }
            )
            rank += 1
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved

    async def update_letterboxd_popular(self) -> int:
        """Letterboxd 本周热门影视"""
        platform = 'Letterboxd'
        chart_name = '本周热门影视'
        
        matcher = TMDBMatcher(self.db)
        items = await self.scrape_letterboxd_popular()
        logger.info(f"{platform} {chart_name}: 抓取阶段返回 {len(items)} 条")
        entries: list[dict] = []
        rank = 1
        missing_url_count = 0
        tmdb_id_direct_hit = 0
        movie_fallback_hit = 0
        tv_fallback_hit = 0
        unmatched_count = 0
        for it in items[:10]:
            title = it.get('title') or ''
            url = it.get('url') or ''
            if not url:
                missing_url_count += 1
                logger.warning(f"{platform} {chart_name}: 缺少 URL，跳过 title={title}")
                rank += 1
                continue
            tmdb_id = await self.get_letterboxd_tmdb_id(url)
            match = None
            actual_media_type = 'movie'
            if tmdb_id:
                info = await matcher.get_tmdb_info(tmdb_id, 'movie')
                if info:
                    match = {
                        'tmdb_id': tmdb_id,
                        'title': self._safe_get_title(info, title),
                        'poster': info.get('poster_url', ''),
                        'media_type': 'movie'
                    }
                    tmdb_id_direct_hit += 1
                else:
                    info = await matcher.get_tmdb_info(tmdb_id, 'tv')
                    if info:
                        match = {
                            'tmdb_id': tmdb_id,
                            'title': self._safe_get_title(info, title),
                            'poster': info.get('poster_url', ''),
                            'media_type': 'tv'
                        }
                        actual_media_type = 'tv'
                        tmdb_id_direct_hit += 1
            if not match:
                for attempt in range(3):
                    try:
                        mid = await matcher.match_by_title_and_year(title, 'movie')
                        if not mid:
                            raise RuntimeError('no id')
                        info = await matcher.get_tmdb_info(mid, 'movie')
                        if not info:
                            raise RuntimeError('no info')
                        match = {
                            'tmdb_id': mid,
                            'title': self._safe_get_title(info, title),
                            'poster': info.get('poster_url', ''),
                            'media_type': 'movie'
                        }
                        movie_fallback_hit += 1
                        break
                    except Exception:
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
                if not match:
                    for attempt in range(3):
                        try:
                            mid = await matcher.match_by_title_and_year(title, 'tv')
                            if not mid:
                                raise RuntimeError('no id')
                            info = await matcher.get_tmdb_info(mid, 'tv')
                            if not info:
                                raise RuntimeError('no info')
                            match = {
                                'tmdb_id': mid,
                                'title': self._safe_get_title(info, title),
                                'poster': info.get('poster_url', ''),
                                'media_type': 'tv'
                            }
                            actual_media_type = 'tv'
                            tv_fallback_hit += 1
                            break
                        except Exception:
                            if attempt < 2:
                                await asyncio.sleep(2 ** attempt)
            if not match:
                unmatched_count += 1
                logger.warning(f"Letterboxd 本周热门影视 未匹配: {title}")
                rank += 1
                continue
            
            entries.append(
                {
                    "media_type": match.get("media_type", actual_media_type),
                    "rank": rank,
                    "tmdb_id": match["tmdb_id"],
                    "title": match.get("title") or title,
                    "poster": match.get("poster", ""),
                }
            )
            rank += 1
        entries.sort(key=lambda x: x["rank"])
        logger.info(
            f"{platform} {chart_name}: 匹配统计 direct={tmdb_id_direct_hit}, movie_fallback={movie_fallback_hit}, "
            f"tv_fallback={tv_fallback_hit}, unmatched={unmatched_count}, missing_url={missing_url_count}, entries={len(entries)}"
        )
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved

    async def _extract_imdb_from_metacritic(self, url: str) -> Optional[str]:
        """从 Metacritic 页面提取 IMDb ID"""
        try:
            import requests, urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8'
            }
            resp = requests.get(url, headers=headers, timeout=20, verify=False)
            if resp.status_code != 200:
                return None
            m = re.search(r'imdbId:\\"(tt\\d+)\\"', resp.text)
            if not m:
                m = re.search(r'imdbId:\s*\\"(tt\\d+)\\"', resp.text)
            return m.group(1) if m else None
        except Exception:
            return None

    async def update_metacritic_movies(self) -> int:
        """Metacritic 本周趋势电影"""
        platform = 'Metacritic'
        chart_name = '本周趋势电影'
        
        matcher = TMDBMatcher(self.db)
        items = await self.scrape_metacritic_trending_movies()
        entries: list[dict] = []
        rank = 1
        for it in items[:10]:
            title = it.get('title') or ''
            url = it.get('url') or ''
            if not url:
                rank += 1
                continue
            imdb_id = await self._extract_imdb_from_metacritic(url)
            match = None
            if imdb_id:
                match = await matcher.match_imdb_with_tmdb(imdb_id, title, 'movie')
            if not match:
                mid = await matcher.match_by_title_and_year(title, 'movie')
                if mid:
                    info = await matcher.get_tmdb_info(mid, 'movie')
                    if info:
                        match = {'tmdb_id': mid, 'title': self._safe_get_title(info, title), 'poster': info.get('poster_url',''), 'media_type': 'movie'}
            if not match:
                logger.warning(f"Metacritic 本周趋势电影 未匹配: {title}")
                rank += 1
                continue
            
            entries.append(
                {
                    "media_type": match.get("media_type", "movie"),
                    "rank": rank,
                    "tmdb_id": match["tmdb_id"],
                    "title": match.get("title", title),
                    "poster": match.get("poster", ""),
                }
            )
            rank += 1
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved

    async def update_metacritic_shows(self) -> int:
        """Metacritic 本周趋势剧集"""
        platform = 'Metacritic'
        chart_name = '本周趋势剧集'
        
        matcher = TMDBMatcher(self.db)
        items = await self.scrape_metacritic_trending_shows()
        entries: list[dict] = []
        rank = 1
        for it in items[:10]:
            title = it.get('title') or ''
            url = it.get('url') or ''
            if not url:
                rank += 1
                continue
            imdb_id = await self._extract_imdb_from_metacritic(url)
            match = None
            if imdb_id:
                match = await matcher.match_imdb_with_tmdb(imdb_id, title, 'tv')
            if not match:
                mid = await matcher.match_by_title_and_year(title, 'tv')
                if mid:
                    info = await matcher.get_tmdb_info(mid, 'tv')
                    if info:
                        match = {'tmdb_id': mid, 'title': self._safe_get_title(info, title), 'poster': info.get('poster_url',''), 'media_type': 'tv'}
            if not match:
                logger.warning(f"Metacritic 本周趋势剧集 未匹配: {title}")
                rank += 1
                continue
            
            entries.append(
                {
                    "media_type": match.get("media_type", "tv"),
                    "rank": rank,
                    "tmdb_id": match["tmdb_id"],
                    "title": match.get("title", title),
                    "poster": match.get("poster", ""),
                }
            )
            rank += 1
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved

    async def update_tmdb_trending_all_week(self) -> int:
        """TMDB 本周趋势影视"""
        import urllib3, requests, re
        from bs4 import BeautifulSoup
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

        def fetch_from_remote_panel() -> list[dict]:
            try:
                panel_url = "https://www.themoviedb.org/remote/panel?panel=trending_scroller&group=this-week"
                headers_html = {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                }
                rr = requests.get(panel_url, headers=headers_html, timeout=20, verify=False)
                if rr.status_code != 200:
                    logger.warning(f"TMDB remote panel 调用失败: {rr.status_code}")
                    return []
                html = rr.text
                soup = BeautifulSoup(html, 'html.parser')
                items: list[dict] = []
                seen: set[tuple[str,int]] = set()
                for a in soup.select('a[href^="/movie/"] , a[href^="/tv/"]'):
                    href = a.get('href') or ''
                    m = re.match(r'^/(movie|tv)/(\d+)', href)
                    if not m:
                        continue
                    media_type, sid = m.group(1), int(m.group(2))
                    key = (media_type, sid)
                    if key in seen:
                        continue
                    title = (a.get('title') or a.get_text(strip=True) or '').strip()
                    items.append({'media_type': media_type, 'tmdb_id': sid, 'title': title})
                    seen.add(key)

                return items[:10]
            except Exception as ex:
                logger.error(f"解析 TMDB remote panel 失败: {ex}")
                return []

        def fetch_from_official_api() -> list[dict]:
            headers_api = {
                'Authorization': f'Bearer {TMDB_TOKEN}',
                'accept': 'application/json'
            }
            url = f"{TMDB_API_BASE_URL}/trending/all/week"
            try:
                r = requests.get(url, headers=headers_api, timeout=20, verify=False)
                if r.status_code != 200:
                    return []
                data = r.json()
                arr = []
                for it in (data.get('results') or [])[:10]:
                    arr.append({
                        'media_type': it.get('media_type'),
                        'tmdb_id': int(it.get('id')),
                        'title': it.get('title') or it.get('name') or ''
                    })
                return arr
            except Exception:
                return []

        items = fetch_from_remote_panel()
        if not items:
            items = fetch_from_official_api()
        if not items:
            logger.error("TMDB 本周趋势影视 页面与API均无结果")
            return 0

        platform = 'TMDB'
        chart_name = '本周趋势影视'
        entries: list[dict] = []
        matcher = TMDBMatcher(self.db)
        for idx, item in enumerate(items[:10], 1):
            tmdb_id = int(item.get('tmdb_id'))
            media_type = item.get('media_type') or 'movie'
            title = item.get('title') or ''
            poster = ''
            try:
                info = await matcher.get_tmdb_info(tmdb_id, media_type)
                if info:
                    title = self._safe_get_title(info, title)
                    poster = info.get('poster_url', '')
            except Exception:
                pass
            entries.append(
                {
                    "media_type": media_type,
                    "rank": idx,
                    "tmdb_id": tmdb_id,
                    "title": title,
                    "poster": poster,
                }
            )

        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"TMDB 本周趋势影视 入库 {saved} 条（来源：{'remote panel' if items else 'api'}）")
        return saved

    async def update_tmdb_top250_movies(self) -> int:
        """TMDB 高分电影 Top 250"""
        import requests
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        platform = 'TMDB'
        chart_name = 'TMDB 高分电影 Top 250'
        headers = {
            'Authorization': f'Bearer {TMDB_TOKEN}',
            'accept': 'application/json'
        }
        
        matcher = TMDBMatcher(self.db)
        all_items = []
        
        for page in range(1, 14):
            try:
                url = f"{TMDB_API_BASE_URL}/movie/top_rated?page={page}"
                response = requests.get(url, headers=headers, timeout=20, verify=False)
                
                if response.status_code != 200:
                    logger.warning(f"TMDB 高分电影 Top 250 API 调用失败 (page {page}): {response.status_code}")
                    break
                
                data = response.json()
                results = data.get('results', [])
                
                if not results:
                    break
                
                for item in results:
                    tmdb_id = int(item.get('id', 0))
                    if tmdb_id:
                        all_items.append({
                            'tmdb_id': tmdb_id,
                            'title': item.get('title', ''),
                            'poster_path': item.get('poster_path', '')
                        })
                
                if len(all_items) >= 250:
                    break
                    
                await asyncio.sleep(0.3)
                
            except Exception as e:
                logger.error(f"TMDB 高分电影 Top 250 获取第 {page} 页失败: {e}")
                continue
        
        all_items = all_items[:250]
        entries: list[dict] = []
        for rank, item in enumerate(all_items, 1):
            tmdb_id = item['tmdb_id']
            title = item.get('title', '')
            poster_path = item.get('poster_path', '')
            try:
                info = await matcher.get_tmdb_info(tmdb_id, 'movie')
                if info:
                    title = self._safe_get_title(info, title)
                    poster = info.get('poster_url', '')
                else:
                    poster = f"https://tmdb.ratefuse.cn/t/p/w500{poster_path}" if poster_path else ""
            except Exception as e:
                logger.warning(f"TMDB 高分电影 Top 250 获取详细信息失败 (rank {rank}, tmdb_id {tmdb_id}): {e}")
                poster = f"https://tmdb.ratefuse.cn/t/p/w500{poster_path}" if poster_path else ""
            
            entries.append(
                {
                    "media_type": "movie",
                    "rank": rank,
                    "tmdb_id": tmdb_id,
                    "title": title,
                    "poster": poster,
                }
            )

        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved

    async def update_tmdb_top250_tv(self) -> int:
        """TMDB 高分剧集 Top 250"""
        import requests
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        platform = 'TMDB'
        chart_name = 'TMDB 高分剧集 Top 250'
        headers = {
            'Authorization': f'Bearer {TMDB_TOKEN}',
            'accept': 'application/json'
        }
        
        matcher = TMDBMatcher(self.db)
        all_items = []
        
        for page in range(1, 14):
            try:
                url = f"{TMDB_API_BASE_URL}/tv/top_rated?page={page}"
                response = requests.get(url, headers=headers, timeout=20, verify=False)
                
                if response.status_code != 200:
                    logger.warning(f"TMDB 高分剧集 Top 250 API 调用失败 (page {page}): {response.status_code}")
                    break
                
                data = response.json()
                results = data.get('results', [])
                
                if not results:
                    break
                
                for item in results:
                    tmdb_id = int(item.get('id', 0))
                    if tmdb_id:
                        all_items.append({
                            'tmdb_id': tmdb_id,
                            'title': item.get('name', ''),
                            'poster_path': item.get('poster_path', '')
                        })
                
                if len(all_items) >= 250:
                    break
                    
                await asyncio.sleep(0.3)
                
            except Exception as e:
                logger.error(f"TMDB 高分剧集 Top 250 获取第 {page} 页失败: {e}")
                continue
        
        all_items = all_items[:250]
        entries: list[dict] = []
        for rank, item in enumerate(all_items, 1):
            tmdb_id = item['tmdb_id']
            title = item.get('title', '')
            poster_path = item.get('poster_path', '')
            try:
                info = await matcher.get_tmdb_info(tmdb_id, 'tv')
                if info:
                    title = self._safe_get_title(info, title)
                    poster = info.get('poster_url', '')
                else:
                    poster = f"https://tmdb.ratefuse.cn/t/p/w500{poster_path}" if poster_path else ""
            except Exception as e:
                logger.warning(f"TMDB 高分剧集 Top 250 获取详细信息失败 (rank {rank}, tmdb_id {tmdb_id}): {e}")
                poster = f"https://tmdb.ratefuse.cn/t/p/w500{poster_path}" if poster_path else ""
            
            entries.append(
                {
                    "media_type": "tv",
                    "rank": rank,
                    "tmdb_id": tmdb_id,
                    "title": title,
                    "poster": poster,
                }
            )

        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved

    async def scrape_imdb_top250(self, chart_url: str, media_type: str) -> List[Dict]:
        """IMDb Top 250 榜单"""
        async def scrape_with_browser(browser):
            context = None
            page = None
            try:
                context_options = {
                    'viewport': {'width': 1920, 'height': 1080},
                    'user_agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                    'bypass_csp': True,
                    'ignore_https_errors': True,
                    'java_script_enabled': True,
                    'has_touch': False,
                    'is_mobile': False,
                    'locale': 'en-US',
                    'timezone_id': 'America/Los_Angeles',
                    'extra_http_headers': {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'DNT': '1',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Cache-Control': 'max-age=0'
                    }
                }
                context = await browser.new_context(**context_options)
                page = await context.new_page()
                page.set_default_timeout(60000)
                logger.info("访问 IMDb 首页建立会话...")
                try:
                    await page.goto("https://www.imdb.com/", wait_until="domcontentloaded", timeout=30000)
                    await asyncio.sleep(2)
                    await page.evaluate("window.scrollTo(0, Math.random() * 500)")
                    await asyncio.sleep(1)
                except Exception as e:
                    logger.warning(f"访问 IMDb 首页失败: {e}")
                
                logger.info(f"访问 IMDb Top 250 页面: {chart_url}")
                await page.goto(chart_url, wait_until="networkidle", timeout=60000)
                await asyncio.sleep(5)
                
                logger.info("滚动页面以加载所有内容...")
                import re
                last_json_count = 0
                scroll_attempts = 0
                max_scroll_attempts = 15
                
                while scroll_attempts < max_scroll_attempts:
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await asyncio.sleep(2)
                    
                    page_content = await page.content()
                    rank_count = len(re.findall(r'"currentRank":\d+', page_content))
                    
                    logger.debug(f"滚动尝试 {scroll_attempts + 1}: 找到 {rank_count} 个排名数据")
                    
                    if rank_count >= 250:
                        logger.info(f"已加载所有内容，找到 {rank_count} 个排名数据")
                        break
                    
                    if rank_count == last_json_count and rank_count > 0:
                        logger.debug(f"排名数据数量未增加，可能已加载完成（{rank_count} 个）")
                        await asyncio.sleep(2)
                        page_content = await page.content()
                        new_count = len(re.findall(r'"currentRank":\d+', page_content))
                        if new_count == rank_count:
                            break
                        rank_count = new_count
                    
                    last_json_count = rank_count
                    scroll_attempts += 1
                
                await page.evaluate("window.scrollTo(0, 0)")
                await asyncio.sleep(1)
                
                chart_data = []
                logger.info("从页面源代码提取 JSON 数据")
                try:
                    page_content = await page.content()
                    import re
                    import json
                    
                    rank_matches = list(re.finditer(r'"currentRank":(\d+)', page_content))
                    logger.info(f"在页面源代码中找到 {len(rank_matches)} 个 currentRank")
                    
                    for rank_match in rank_matches:
                        rank = int(rank_match.group(1))
                        start_pos = rank_match.start()
                        segment = page_content[start_pos:start_pos + 5000]
                        
                        id_match = re.search(r'"id":"(tt\d+)"', segment)
                        if not id_match:
                            continue
                        
                        title_match = re.search(r'"titleText":\s*\{[^}]*"text":\s*"([^"]+)"', segment)
                        if not title_match:
                            continue
                        
                        imdb_id = id_match.group(1)
                        title = title_match.group(1)
                        
                        if not any(m.get("currentRank") == rank and m.get("node", {}).get("id") == imdb_id for m in chart_data):
                            title = title.replace('\\"', '"').replace('\\n', ' ').replace('\\/', '/').replace('\\\\', '\\')
                            chart_data.append({
                                "currentRank": rank,
                                "node": {
                                    "id": imdb_id,
                                    "titleText": {"text": title}
                                }
                            })
                    
                    if chart_data:
                        chart_data.sort(key=lambda x: x.get("currentRank", 0))
                        logger.info(f"从页面源代码提取到 {len(chart_data)} 条数据")
                        matches = []
                    else:
                        matches = []
                    
                    if not chart_data:
                        logger.warning("JSON 提取失败，尝试从 DOM 提取数据（后备方案）...")
                        items = await page.query_selector_all('a[href*="/title/tt"]')
                        logger.debug(f"选择器 'a[href*=\"/title/tt\"]' 找到 {len(items)} 个元素")
                        
                        for item in items[:250]:
                            try:
                                if item.tag_name == 'a':
                                    link = item
                                else:
                                    link = await item.query_selector('a[href*="/title/tt"]')
                                
                                if link:
                                    href = await link.get_attribute('href')
                                    if not href:
                                        continue
                                    
                                    imdb_match = re.search(r'/title/(tt\d+)/', href)
                                    if not imdb_match:
                                        continue
                                    
                                    imdb_id = imdb_match.group(1)
                                    
                                    rank = None
                                    rank_match = re.search(r'chttvtp_t_(\d+)', href)
                                    if rank_match:
                                        rank = int(rank_match.group(1))
                                    else:
                                        rank_match = re.search(r'chttp_t[^_]*_(\d+)', href)
                                        if rank_match:
                                            rank = int(rank_match.group(1))
                                        else:
                                            rank_match = re.search(r'chttp_tv?_(\d+)', href)
                                            if rank_match:
                                                rank = int(rank_match.group(1))
                                    
                                    if not rank:
                                        try:
                                            if item.tag_name != 'a':
                                                rank_elem = await item.query_selector('.ipc-title-link-number, [class*="rank"], [class*="position"], span[class*="rank"]')
                                            else:
                                                parent = await link.evaluate_handle('el => el.closest("li, div, tr")')
                                                if parent:
                                                    rank_elem = await parent.query_selector('.ipc-title-link-number, [class*="rank"], [class*="position"], span[class*="rank"]')
                                                else:
                                                    rank_elem = None
                                            
                                            if rank_elem:
                                                rank_text = await rank_elem.inner_text()
                                                rank_match = re.search(r'(\d+)', rank_text)
                                                if rank_match:
                                                    rank = int(rank_match.group(1))
                                        except Exception as e:
                                            logger.debug(f"查找排名元素失败: {e}")
                                    
                                    if not rank:
                                        rank = len(chart_data) + 1
                                    
                                    title_elem = await link.query_selector('h3.ipc-title__text, .ipc-title__text, h3')
                                    title = ""
                                    if title_elem:
                                        title = await title_elem.inner_text()
                                    else:
                                        title = await link.inner_text()
                                    title = title.strip()
                                    
                                    if title and imdb_id:
                                        chart_data.append({
                                            "currentRank": rank,
                                            "node": {
                                                "id": imdb_id,
                                                "titleText": {"text": title}
                                            }
                                        })
                            except Exception as e:
                                logger.debug(f"提取列表项失败: {e}")
                                continue
                    
                    if chart_data:
                        logger.info(f"从页面 DOM 中获取到 {len(chart_data)} 条数据")
                    else:
                        logger.warning("未能从页面提取到任何数据")
                except Exception as e:
                    logger.error(f"从页面 DOM 提取数据失败: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
                
                if not chart_data:
                    import os
                    screenshot_dir = "screenshots"
                    os.makedirs(screenshot_dir, exist_ok=True)
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    screenshot_path = os.path.join(screenshot_dir, f"imdb_top250_{media_type}_{timestamp}.png")
                    try:
                        await page.screenshot(path=screenshot_path, full_page=True)
                        logger.info(f"已保存页面截图到: {screenshot_path}")
                    except Exception as screenshot_error:
                        logger.warning(f"保存截图失败: {screenshot_error}")
                    
                    try:
                        page_title = await page.title()
                        page_content = await page.content()
                        logger.error(f"页面标题: {page_title}")
                        
                        if ("403" in page_title or "Forbidden" in page_title) and "Top 250" not in page_title:
                            raise Exception("遇到反爬虫机制（403 Forbidden），请稍后重试或检查网络连接")
                        if "403" in page_content[:1000] and "Forbidden" in page_content[:1000] and "Top 250" not in page_title:
                            raise Exception("遇到反爬虫机制（403 Forbidden），请稍后重试或检查网络连接")
                        elif "error" in page_title.lower() or "not found" in page_title.lower():
                            raise Exception(f"页面错误: {page_title}")
                        
                        if "Top 250" in page_title:
                            logger.warning("页面加载成功，但未能提取数据。可能是选择器不匹配。")
                            all_elements = await page.query_selector_all('*')
                            logger.warning(f"页面共有 {len(all_elements)} 个元素")
                            all_title_links = await page.query_selector_all('a[href*="/title/"]')
                            logger.warning(f"找到 {len(all_title_links)} 个包含 /title/ 的链接")
                            if all_title_links:
                                for i, link in enumerate(all_title_links[:5]):
                                    try:
                                        href = await link.get_attribute('href')
                                        logger.warning(f"链接示例 {i+1}: {href}")
                                    except:
                                        pass
                            
                            html_path = os.path.join(screenshot_dir, f"imdb_top250_{media_type}_{timestamp}.html")
                            try:
                                with open(html_path, 'w', encoding='utf-8') as f:
                                    f.write(page_content)
                                logger.info(f"已保存页面 HTML 到: {html_path}")
                            except Exception as html_error:
                                logger.warning(f"保存 HTML 失败: {html_error}")
                    except Exception as check_error:
                        if "反爬虫机制" in str(check_error) or "页面错误" in str(check_error):
                            raise check_error
                        pass
                    raise Exception("未能获取到 IMDb Top 250 数据")
                
                results = []
                for edge in chart_data:
                    try:
                        if isinstance(edge, dict):
                            rank = edge.get("currentRank")
                            node = edge.get("node", {})
                            
                            if not rank and not node:
                                rank = edge.get("currentRank")
                                node = edge.get("node", {})
                            
                            imdb_id = node.get("id") if isinstance(node, dict) else None
                            title_text = node.get("titleText", {}) if isinstance(node, dict) else {}
                            title = title_text.get("text", "") if isinstance(title_text, dict) else ""
                            
                            if imdb_id and rank:
                                results.append({
                                    "rank": int(rank),
                                    "title": title,
                                    "imdb_id": imdb_id
                                })
                    except Exception as e:
                        logger.warning(f"解析数据项失败: {e}")
                        continue
                
                results.sort(key=lambda x: x["rank"])
                
                logger.info(f"IMDb Top 250 ({media_type}) 获取到 {len(results)} 条数据")
                return results
                
            except Exception as e:
                logger.error(f"抓取 IMDb Top 250 ({media_type}) 失败: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return []
            finally:
                if page:
                    await page.close()
                if context:
                    await context.close()
        
        try:
            return await browser_pool.execute_in_browser(scrape_with_browser)
        except Exception as e:
            logger.error(f"IMDb Top 250 ({media_type}) 抓取失败: {e}")
            return []

    async def update_imdb_top250_movies(self) -> int:
        """IMDb 电影 Top 250"""
        platform = 'IMDb'
        chart_name = 'IMDb 电影 Top 250'
        matcher = TMDBMatcher(self.db)
        items = await self.scrape_imdb_top250("https://www.imdb.com/chart/top/", "movie")
        
        if not items:
            logger.error("未能获取到 IMDb 电影 Top 250 数据")
            return 0
        
        entries: list[dict] = []
        total = len(items[:250])
        
        semaphore = asyncio.Semaphore(10)
        
        async def process_item(item: Dict) -> Optional[Dict]:
            """处理单个项目，返回匹配结果或None"""
            async with semaphore:
                rank = item.get('rank')
                title = item.get('title') or ''
                imdb_id = item.get('imdb_id') or ''

                if not imdb_id:
                    logger.warning(f"IMDb 电影 Top 250 排名 {rank}: 缺少 IMDb ID")
                    return None
                
                try:
                    match = await matcher.match_imdb_with_tmdb(imdb_id, title, 'movie')
                    if not match:
                        logger.warning(f"IMDb 电影 Top 250 排名 {rank} ({title}): 未匹配到 TMDB")
                        return None
                    
                    return {
                        'rank': rank,
                        'match': match,
                        'title': title
                    }
                except Exception as e:
                    logger.warning(f"IMDb 电影 Top 250 排名 {rank} ({title}): 匹配失败: {e}")
                    return None
        
        batch_size = 30
        for batch_start in range(0, total, batch_size):
            batch = items[batch_start:batch_start + batch_size]
            results = await asyncio.gather(*[process_item(item) for item in batch], return_exceptions=True)
            
            for result in results:
                if isinstance(result, Exception):
                    continue
                if not result:
                    continue
                
                rank = result['rank']
                match = result['match']
                title = result['title']
                
                media_type = match.get('media_type') or 'movie'
                entries.append(
                    {
                        "media_type": media_type,
                        "rank": rank,
                        "tmdb_id": match["tmdb_id"],
                        "title": match.get("title", title),
                        "poster": match.get("poster", ""),
                    }
                )
            
            logger.info(f"IMDb 电影 Top 250 收集进度: {min(batch_start + batch_size, total)}/{total} 条已处理")
            
            if batch_start + batch_size < total:
                await asyncio.sleep(0.3)

        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"IMDb 电影 Top 250 入库完成，共 {saved}/{total} 条")
        return saved

    async def update_imdb_top250_tv(self) -> int:
        """IMDb 剧集 Top 250"""
        platform = 'IMDb'
        chart_name = 'IMDb 剧集 Top 250'
        matcher = TMDBMatcher(self.db)
        items = await self.scrape_imdb_top250("https://www.imdb.com/chart/toptv/", "tv")
        
        if not items:
            logger.error("未能获取到 IMDb 剧集 Top 250 数据")
            return 0
        
        entries: list[dict] = []
        total = len(items[:250])
        
        semaphore = asyncio.Semaphore(10)
        
        async def process_item(item: Dict) -> Optional[Dict]:
            """处理单个项目，返回匹配结果或None"""
            async with semaphore:
                rank = item.get('rank')
                title = item.get('title') or ''
                imdb_id = item.get('imdb_id') or ''

                if not imdb_id:
                    logger.warning(f"IMDb 剧集 Top 250 排名 {rank}: 缺少 IMDb ID")
                    return None
                
                try:
                    match = await matcher.match_imdb_with_tmdb(imdb_id, title, 'tv')
                    if not match:
                        logger.warning(f"IMDb 剧集 Top 250 排名 {rank} ({title}): 未匹配到 TMDB")
                        return None
                    
                    return {
                        'rank': rank,
                        'match': match,
                        'title': title
                    }
                except Exception as e:
                    logger.warning(f"IMDb 剧集 Top 250 排名 {rank} ({title}): 匹配失败: {e}")
                    return None
        
        batch_size = 30
        for batch_start in range(0, total, batch_size):
            batch = items[batch_start:batch_start + batch_size]
            results = await asyncio.gather(*[process_item(item) for item in batch], return_exceptions=True)
            
            for result in results:
                if isinstance(result, Exception):
                    continue
                if not result:
                    continue
                
                rank = result['rank']
                match = result['match']
                title = result['title']
                
                media_type = match.get('media_type') or 'tv'
                entries.append(
                    {
                        "media_type": media_type,
                        "rank": rank,
                        "tmdb_id": match["tmdb_id"],
                        "title": match.get("title", title),
                        "poster": match.get("poster", ""),
                    }
                )
            
            logger.info(f"IMDb 剧集 Top 250 收集进度: {min(batch_start + batch_size, total)}/{total} 条已处理")
            
            if batch_start + batch_size < total:
                await asyncio.sleep(0.3)

        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"IMDb 剧集 Top 250 入库完成，共 {saved}/{total} 条")
        return saved

    async def scrape_douban_top250(self, douban_cookie: Optional[str] = None) -> List[Dict]:
        """豆瓣 Top 250 榜单"""
        async def scrape_with_browser(browser):
            context = None
            page = None
            try:
                context_options = {
                    'viewport': {'width': 1280, 'height': 720},
                    'user_agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
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
                page = await context.new_page()
                page.set_default_timeout(60000)
                
                if douban_cookie:
                    cookies = []
                    for cookie_pair in douban_cookie.split(';'):
                        cookie_pair = cookie_pair.strip()
                        if '=' in cookie_pair:
                            key, value = cookie_pair.split('=', 1)
                            cookies.append({
                                'name': key.strip(),
                                'value': value.strip(),
                                'domain': '.douban.com',
                                'path': '/'
                            })
                    if cookies:
                        await context.add_cookies(cookies)
                        logger.info(f"已设置豆瓣 Cookie")
                
                logger.info("访问豆瓣首页建立会话...")
                try:
                    await page.goto("https://www.douban.com/", wait_until="domcontentloaded", timeout=30000)
                    await asyncio.sleep(2)
                    await page.evaluate("window.scrollTo(0, Math.random() * 500)")
                    await asyncio.sleep(1)
                except Exception as e:
                    logger.warning(f"访问豆瓣首页失败: {e}")
                
                all_movies = []
                import random
                
                for page_num in range(10):
                    start = page_num * 25
                    url = f"https://movie.douban.com/top250?start={start}"
                    logger.info(f"访问豆瓣 Top 250 第 {page_num + 1} 页: {url}")
                    
                    if page_num > 0:
                        delay = random.uniform(3, 8)
                        logger.debug(f"随机延迟 {delay:.2f} 秒")
                        await asyncio.sleep(delay)
                    
                    await page.goto(url, wait_until="domcontentloaded", timeout=60000)
                    
                    await page.evaluate("window.scrollTo(0, Math.random() * 300)")
                    await asyncio.sleep(random.uniform(1, 3))
                    
                    try:
                        await page.wait_for_load_state("networkidle", timeout=30000)
                    except Exception:
                        await asyncio.sleep(3)
                    
                    page_title = await page.title()
                    logger.debug(f"第 {page_num + 1} 页页面标题: {page_title}")
                    
                    if '禁止访问' in page_title or '禁止' in page_title:
                        logger.error(f"第 {page_num + 1} 页返回禁止访问页面，需要验证")
                        raise Exception("ANTI_SCRAPING_DETECTED")
                    
                    page_content = await page.content()
                    if '禁止访问' in page_content or '<title>禁止访问</title>' in page_content:
                        logger.error(f"第 {page_num + 1} 页检测到禁止访问，需要验证")
                        raise Exception("ANTI_SCRAPING_DETECTED")
                    
                    try:
                        await page.wait_for_selector('div.item', timeout=10000)
                    except Exception as e:
                        logger.warning(f"第 {page_num + 1} 页等待 div.item 超时: {e}")
                        content_preview = page_content[:500] if len(page_content) > 500 else page_content
                        logger.warning(f"第 {page_num + 1} 页内容预览: {content_preview}")
                        
                        if any(keyword in page_content.lower() for keyword in ['验证', 'captcha', 'robot', '机器人', '访问异常', 'unusual traffic', '禁止访问']):
                            logger.error(f"第 {page_num + 1} 页可能触发了反爬虫检测，停止抓取")
                            break
                    
                    items = await page.query_selector_all('div.item')
                    logger.info(f"第 {page_num + 1} 页找到 {len(items)} 个电影项")
                    
                    if len(items) == 0:
                        content_preview = page_content[:500] if len(page_content) > 500 else page_content
                        logger.warning(f"第 {page_num + 1} 页未找到电影项，页面内容预览: {content_preview}")
                        
                        if any(keyword in page_content.lower() for keyword in ['验证', 'captcha', 'robot', '机器人', '访问异常', 'unusual traffic', '禁止访问']):
                            logger.error(f"第 {page_num + 1} 页可能触发了反爬虫检测，停止抓取")
                            break
                    
                    for item in items:
                        try:
                            rank_elem = await item.query_selector('div.pic em')
                            rank_text = await rank_elem.inner_text() if rank_elem else ""
                            rank = int(rank_text) if rank_text.isdigit() else None
                            
                            link_elem = await item.query_selector('div.pic a')
                            if not link_elem:
                                continue
                            
                            href = await link_elem.get_attribute('href')
                            if not href:
                                continue
                            
                            douban_id_match = re.search(r'/subject/(\d+)/', href)
                            if not douban_id_match:
                                continue
                            
                            douban_id = douban_id_match.group(1)
                            
                            title_elem = await item.query_selector('div.info span.title')
                            title = await title_elem.inner_text() if title_elem else ""
                            title = title.strip()
                            
                            all_movies.append({
                                'rank': rank or len(all_movies) + 1,
                                'title': title,
                                'douban_id': douban_id,
                                'url': href
                            })
                        except Exception as e:
                            logger.warning(f"解析电影项失败: {e}")
                            continue
                
                all_movies.sort(key=lambda x: x['rank'])
                
                logger.info(f"豆瓣 Top 250 获取到 {len(all_movies)} 条电影链接")
                return all_movies
                
            except Exception as e:
                logger.error(f"抓取豆瓣 Top 250 失败: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return []
            finally:
                if page:
                    await page.close()
                if context:
                    await context.close()
        
        try:
            return await browser_pool.execute_in_browser(scrape_with_browser)
        except Exception as e:
            logger.error(f"豆瓣 Top 250 抓取失败: {e}")
            return []

    async def get_douban_imdb_id_with_cookie(self, douban_id: str, douban_cookie: Optional[str] = None, max_retries: int = 2) -> Optional[str]:
        """从豆瓣详情页获取IMDb ID"""
        import random
        
        async def get_with_browser(browser):
            context = None
            page = None
            try:
                context_options = {
                    'viewport': {'width': 1280, 'height': 720},
                    'user_agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
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
                page = await context.new_page()
                page.set_default_timeout(30000)
                
                if douban_cookie:
                    cookies = []
                    for cookie_pair in douban_cookie.split(';'):
                        cookie_pair = cookie_pair.strip()
                        if '=' in cookie_pair:
                            key, value = cookie_pair.split('=', 1)
                            cookies.append({
                                'name': key.strip(),
                                'value': value.strip(),
                                'domain': '.douban.com',
                                'path': '/'
                            })
                    if cookies:
                        await context.add_cookies(cookies)
                
                url = f"https://movie.douban.com/subject/{douban_id}/"
                
                for attempt in range(max_retries + 1):
                    try:
                        if attempt > 0:
                            wait_time = random.uniform(5, 10)
                            logger.debug(f"豆瓣详情页 (ID: {douban_id}) 第 {attempt + 1} 次尝试，等待 {wait_time:.2f} 秒")
                            await asyncio.sleep(wait_time)
                        
                        await asyncio.sleep(random.uniform(0.5, 2))
                        
                        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                        
                        await page.evaluate("window.scrollTo(0, Math.random() * 200)")
                        await asyncio.sleep(random.uniform(0.5, 1.5))
                        
                        try:
                            await page.wait_for_load_state("networkidle", timeout=10000)
                        except Exception:
                            await asyncio.sleep(1)
                        
                        page_title = await page.title()
                        if '禁止访问' in page_title or '禁止' in page_title:
                            if attempt < max_retries:
                                logger.warning(f"豆瓣详情页 (ID: {douban_id}) 返回禁止访问页面，将重试")
                                continue
                            else:
                                logger.warning(f"豆瓣详情页 (ID: {douban_id}) 返回禁止访问页面，已达最大重试次数")
                                return None
                        
                        content = await page.content()
                        
                        if '禁止访问' in content or '<title>禁止访问</title>' in content:
                            if attempt < max_retries:
                                logger.warning(f"豆瓣详情页 (ID: {douban_id}) 检测到禁止访问，将重试")
                                continue
                            else:
                                logger.warning(f"豆瓣详情页 (ID: {douban_id}) 检测到禁止访问，已达最大重试次数")
                                return None
                        
                        try:
                            await page.wait_for_selector('a[href*="imdb.com/title/tt"]', timeout=5000)
                        except Exception:
                            pass
                        
                        from bs4 import BeautifulSoup
                        soup = BeautifulSoup(content, 'html.parser')
                        
                        imdb_links = soup.find_all('a', href=lambda x: x and 'imdb.com' in x)
                        for link in imdb_links:
                            href = link.get('href', '')
                            if '/title/tt' in href:
                                imdb_id = href.split('/title/')[-1].rstrip('/')
                                if imdb_id.startswith('tt'):
                                    return imdb_id
                        
                        imdb_spans = soup.find_all('span', class_='pl')
                        for span in imdb_spans:
                            if span.get_text().strip() == 'IMDb:':
                                sibling_text = getattr(span.next_sibling, 'strip', lambda: str(span.next_sibling))()
                                if sibling_text:
                                    m = re.search(r'(tt\d+)', sibling_text)
                                    if m:
                                        return m.group(1)

                                next_span = span.find_next_sibling('span')
                                if next_span:
                                    imdb_text = next_span.get_text().strip()
                                    if imdb_text.startswith('tt'):
                                        return imdb_text

                                m2 = re.search(r'<span class="pl">IMDb:</span>\s*([tT]{2}\d+)<br>', content)
                                if m2:
                                    return m2.group(1)
                        
                        return None
                        
                    except Exception as e:
                        if attempt < max_retries:
                            logger.debug(f"获取 豆瓣 IMDb ID失败 (douban_id: {douban_id})，将重试: {e}")
                            continue
                        else:
                            logger.debug(f"获取 豆瓣 IMDb ID失败 (douban_id: {douban_id}): {e}")
                            return None
                
                return None
                
            except Exception as e:
                logger.debug(f"获取 豆瓣 IMDb ID失败 (douban_id: {douban_id}): {e}")
                return None
            finally:
                if page:
                    await page.close()
                if context:
                    await context.close()
        
        try:
            return await browser_pool.execute_in_browser(get_with_browser)
        except Exception as e:
            logger.debug(f"获取 豆瓣 IMDb ID失败: {e}")
            return None

    async def update_douban_top250(self, douban_cookie: Optional[str] = None, request: Optional['Request'] = None) -> int:
        """豆瓣 电影 Top 250"""
        platform = '豆瓣'
        chart_name = '豆瓣 电影 Top 250'
        movies = await self.scrape_douban_top250(douban_cookie)
        
        if not movies:
            logger.error("未能获取到 豆瓣 电影 Top 250 数据")
            return 0
        
        matcher = TMDBMatcher(self.db)
        entries: list[dict] = []
        total = len(movies[:250])
        
        semaphore = asyncio.Semaphore(3)
        
        async def process_movie(movie: Dict) -> Optional[Dict]:
            """处理单个电影，返回匹配结果或None"""
            nonlocal saved
            async with semaphore:
                rank = movie.get('rank')
                title = movie.get('title') or ''
                douban_id = movie.get('douban_id') or ''

                if not douban_id:
                    logger.warning(f"豆瓣 电影 Top 250 排名 {rank}: 缺少豆瓣 ID")
                    return None
                
                try:
                    imdb_id = await self.get_douban_imdb_id_with_cookie(douban_id, douban_cookie)
                    
                    if not imdb_id:
                        logger.warning(f"豆瓣 电影 Top 250 排名 {rank} ({title}): 未能获取 IMDb ID")
                        return None
                    
                    match = None
                    try:
                        match = await matcher.match_imdb_with_tmdb(imdb_id, title, 'movie')
                    except Exception as e:
                        logger.warning(f"豆瓣 电影 Top 250 排名 {rank} ({title}): 匹配失败: {e}")
                    
                    if not match:
                        logger.warning(f"豆瓣 电影 Top 250 排名 {rank} ({title}): 未匹配到 TMDB")
                        return None
                    
                    return {
                        'rank': rank,
                        'match': match,
                        'title': title
                    }
                except Exception as e:
                    logger.error(f"豆瓣 电影 Top 250 排名 {rank} ({title}) 处理失败: {e}")
                    return None
        
        batch_size = 10
        for batch_start in range(0, total, batch_size):
            batch = movies[batch_start:batch_start + batch_size]
            results = await asyncio.gather(*[process_movie(movie) for movie in batch], return_exceptions=True)
            
            for result in results:
                if isinstance(result, Exception):
                    continue
                if not result:
                    continue
                
                rank = result['rank']
                match = result['match']
                title = result['title']
                
                media_type = match.get('media_type') or 'movie'
                entries.append(
                    {
                        "media_type": media_type,
                        "rank": rank,
                        "tmdb_id": match["tmdb_id"],
                        "title": match.get("title", title),
                        "poster": match.get("poster", ""),
                    }
                )
            
            logger.info(f"豆瓣 电影 Top 250 收集进度: {min(batch_start + batch_size, total)}/{total} 条已处理")
            
            if batch_start + batch_size < total:
                await asyncio.sleep(0.5)
        
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"豆瓣 电影 Top 250 入库完成，共 {saved}/{total} 条")
        return saved

    async def scrape_letterboxd_top250(self) -> List[Dict]:
        """Letterboxd Top 250 榜单"""
        async def scrape_with_browser(browser):
            ctx_to_close = None
            page = await browser.new_page()
            try:
                letterboxd_cookie = os.environ.get("LETTERBOXD_COOKIE", "").strip()
                if letterboxd_cookie:
                    cookies = _parse_letterboxd_cookie_string(letterboxd_cookie)
                    if cookies:
                        await page.context.add_cookies(cookies)
                        logger.info("Letterboxd Top 250: 已注入 LETTERBOXD_COOKIE")
                all_movies = []
                base_url = "https://letterboxd.com/official/list/letterboxds-top-500-films/"
                
                for page_num in range(1, 4):
                    if page_num == 1:
                        url = f"{base_url}/"
                    else:
                        url = f"{base_url}/page/{page_num}/"
                    
                    logger.info(f"访问 Letterboxd Top 250 第 {page_num} 页: {url}")
                    
                    await page.goto(url, wait_until="domcontentloaded", timeout=60000)
                    await asyncio.sleep(2)
                    if await _is_cloudflare_challenge(page):
                        logger.warning(f"Letterboxd Top 250 第 {page_num} 页: 检测到 Cloudflare，尝试 FlareSolverr…")
                        fs = await _letterboxd_flaresolverr(url)
                        if not fs:
                            logger.warning("Letterboxd Top 250: FlareSolverr 未配置或失败，返回空")
                            return []
                        await page.close()
                        if ctx_to_close:
                            await ctx_to_close.close()
                        ctx_to_close = await browser.new_context(viewport={"width": 1280, "height": 720}, user_agent=fs["userAgent"])
                        await ctx_to_close.add_cookies(fs["cookies"])
                        page = await ctx_to_close.new_page()
                        await page.goto(url, wait_until="domcontentloaded", timeout=60000)
                        await asyncio.sleep(2)
                        if await _is_cloudflare_challenge(page):
                            logger.warning("Letterboxd Top 250: FlareSolverr 后仍为 CF，返回空")
                            return []
                    
                    try:
                        await page.wait_for_selector('ul.js-list-entries li.posteritem', timeout=10000)
                    except Exception:
                        pass
                    
                    page_items_count = 0
                    html = await page.content()

                    try:
                        pattern = r'<li[^>]*class="[^"]*posteritem[^"]*numbered-list-item[^"]*"[^>]*>(.*?)</li>'
                        for m in re.finditer(pattern, html, re.DOTALL):
                            block = m.group(1)

                            rank_match = re.search(
                                r'<p[^>]*class="[^"]*list-number[^"]*"[^>]*>\s*(\d+)\s*<',
                                block,
                            )
                            if not rank_match:
                                continue
                            rank = int(rank_match.group(1))

                            title_match = re.search(r'data-item-name="([^"]+)"', block)
                            title = title_match.group(1).strip() if title_match else ""

                            href_match = re.search(r'data-item-link="([^"]+)"', block)
                            href = href_match.group(1).strip() if href_match else ""
                            if not href:
                                href_match = re.search(r'href="(/film/[^"]+/)"', block)
                                href = href_match.group(1).strip() if href_match else ""

                            if not href:
                                continue

                            if href.startswith("/"):
                                full_url = f"https://letterboxd.com{href}"
                            elif href.startswith("http"):
                                full_url = href
                            else:
                                full_url = f"https://letterboxd.com/{href}"

                            all_movies.append({"rank": rank, "title": title, "url": full_url})
                            page_items_count += 1
                    except Exception as e:
                        logger.warning(f"Letterboxd Top 250 第 {page_num} 页: regex 解析失败: {e}")

                    if page_items_count == 0:
                        try:
                            from bs4 import BeautifulSoup

                            soup = BeautifulSoup(html, "html.parser")
                            items = soup.select("ul.js-list-entries li.posteritem.numbered-list-item")
                            if not items:
                                items = soup.select("li.posteritem.numbered-list-item")

                            for item in items:
                                rank_text = (item.select_one("p.list-number") or {}).get_text(strip=True) if item.select_one("p.list-number") else ""
                                rank = int(rank_text) if rank_text.isdigit() else None
                                if not rank:
                                    continue

                                a = item.select_one('a.frame[href*="/film/"]') or item.select_one('a[href*="/film/"]')
                                if not a:
                                    continue

                                href = (a.get("href") or "").strip()
                                if not href:
                                    continue

                                if href.startswith("/"):
                                    full_url = f"https://letterboxd.com{href}"
                                elif href.startswith("http"):
                                    full_url = href
                                else:
                                    full_url = f"https://letterboxd.com/{href}"

                                title = ""
                                react = item.select_one('[data-item-name]')
                                if react and react.get("data-item-name"):
                                    title = react.get("data-item-name", "").strip()
                                if not title:
                                    frame_title = (a.select_one(".frame-title") or {}).get_text(strip=True) if a.select_one(".frame-title") else ""
                                    title = frame_title.strip() if frame_title else ""

                                all_movies.append({"rank": rank, "title": title, "url": full_url})
                                page_items_count += 1
                        except Exception as e:
                            logger.warning(f"Letterboxd Top 250 第 {page_num} 页: soup 解析失败: {e}")

                    if page_items_count == 0:
                        items = await page.query_selector_all('li.posteritem.numbered-list-item')
                        for item in items:
                            try:
                                rank_elem = await item.query_selector('p.list-number')
                                rank_text = await rank_elem.inner_text() if rank_elem else ""
                                rank = int(rank_text.strip()) if rank_text.strip().isdigit() else None

                                if not rank:
                                    continue

                                link_elem = await item.query_selector('a[data-item-link]')
                                if not link_elem:
                                    link_elem = await item.query_selector('a.frame[href*="/film/"]')
                                if not link_elem:
                                    link_elem = await item.query_selector('a[href*="/film/"]')

                                if not link_elem:
                                    continue

                                href = await link_elem.get_attribute('href')
                                if not href:
                                    href = await link_elem.get_attribute('data-item-link')

                                if not href:
                                    continue

                                if href.startswith('/'):
                                    full_url = f"https://letterboxd.com{href}"
                                elif href.startswith('http'):
                                    full_url = href
                                else:
                                    full_url = f"https://letterboxd.com/{href}"

                                title_elem = await item.query_selector('[data-item-name]')
                                title = await title_elem.get_attribute('data-item-name') if title_elem else ""
                                if not title:
                                    ft = await link_elem.query_selector('.frame-title')
                                    title = (await ft.inner_text()) if ft else ""

                                title = title.strip() if title else ""

                                all_movies.append({'rank': rank, 'title': title, 'url': full_url})
                            except Exception as e:
                                logger.warning(f"解析电影项失败: {e}")
                                continue
                    
                    await asyncio.sleep(1)
                
                all_movies.sort(key=lambda x: x['rank'])
                
                logger.info(f"Letterboxd Top 250 获取到 {len(all_movies)} 条电影链接")
                return all_movies
                
            except Exception as e:
                logger.error(f"抓取 Letterboxd Top 250 失败: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return []
            finally:
                if ctx_to_close:
                    await ctx_to_close.close()
                else:
                    await page.close()
        
        try:
            return await browser_pool.execute_in_browser(scrape_with_browser)
        except Exception as e:
            logger.error(f"Letterboxd Top 250 抓取失败: {e}")
            return []

    async def get_letterboxd_tmdb_id(self, letterboxd_url: str) -> Optional[int]:
        """从 Letterboxd 详情页获取 TMDB ID"""
        async def get_with_browser(browser):
            ctx_to_close = None
            page = await browser.new_page()
            try:
                letterboxd_cookie = os.environ.get("LETTERBOXD_COOKIE", "").strip()
                if letterboxd_cookie:
                    cookies = _parse_letterboxd_cookie_string(letterboxd_cookie)
                    if cookies:
                        await page.context.add_cookies(cookies)
                        logger.debug("Letterboxd 详情: 已注入 LETTERBOXD_COOKIE")
                await page.goto(letterboxd_url, wait_until="domcontentloaded", timeout=20000)
                await asyncio.sleep(1)
                if await _is_cloudflare_challenge(page):
                    logger.warning(f"Letterboxd 详情页 CF: {letterboxd_url}，尝试 FlareSolverr…")
                    fs = await _letterboxd_flaresolverr(letterboxd_url)
                    if not fs:
                        return None
                    await page.close()
                    ctx_to_close = await browser.new_context(viewport={"width": 1280, "height": 720}, user_agent=fs["userAgent"])
                    await ctx_to_close.add_cookies(fs["cookies"])
                    page = await ctx_to_close.new_page()
                    await page.goto(letterboxd_url, wait_until="domcontentloaded", timeout=20000)
                    await asyncio.sleep(1)
                    if await _is_cloudflare_challenge(page):
                        return None
                content = await page.content()
                m = re.search(r'data-tmdb-id=["\']?(\d+)', content)
                if m:
                    return int(m.group(1))
                try:
                    await page.wait_for_selector('a[href*="themoviedb.org/movie/"], a[href*="themoviedb.org/tv/"]', timeout=3000)
                except Exception:
                    pass
                for selector in ('a[href*="themoviedb.org/movie/"]', 'a[href*="themoviedb.org/tv/"]'):
                    link = await page.query_selector(selector)
                    if link:
                        href = await link.get_attribute('href') or ''
                        mm = re.search(r'/(?:movie|tv)/(\d+)/', href)
                        if mm:
                            return int(mm.group(1))
                return None
            except Exception as e:
                logger.debug(f"获取 Letterboxd TMDB ID 失败 (url: {letterboxd_url}): {e}")
                return None
            finally:
                if ctx_to_close:
                    await ctx_to_close.close()
                else:
                    await page.close()
        try:
            return await browser_pool.execute_in_browser(get_with_browser)
        except Exception as e:
            logger.debug(f"获取 Letterboxd TMDB ID 失败: {e}")
            return None

    async def update_letterboxd_top250(self) -> int:
        """Letterboxd 电影 Top 250"""
        platform = 'Letterboxd'
        chart_name = 'Letterboxd 电影 Top 250'
        movies = await self.scrape_letterboxd_top250()
        
        if not movies:
            logger.error("未能获取到 Letterboxd 电影 Top 250 数据")
            return 0
        
        matcher = TMDBMatcher(self.db)
        entries: list[dict] = []
        total = len(movies[:250])
        
        semaphore = asyncio.Semaphore(3)
        
        async def process_movie(movie: Dict) -> Optional[Dict]:
            """处理单个电影，返回匹配结果或None"""
            async with semaphore:
                rank = movie.get('rank')
                title = movie.get('title') or ''
                letterboxd_url = movie.get('url') or ''

                if not letterboxd_url:
                    logger.warning(f"Letterboxd 电影 Top 250 排名 {rank}: 缺少链接")
                    return None
                
                try:
                    tmdb_id = await self.get_letterboxd_tmdb_id(letterboxd_url)
                    
                    if not tmdb_id:
                        logger.warning(f"Letterboxd 电影 Top 250 排名 {rank} ({title}): 未能获取 TMDB ID")
                        return None
                    
                    info = await matcher.get_tmdb_info(tmdb_id, 'movie')
                    if info:
                        final_title = self._safe_get_title(info, title)
                        poster = info.get('poster_url', '')
                    else:
                        final_title = title
                        poster = ""
                    
                    return {
                        'rank': rank,
                        'tmdb_id': tmdb_id,
                        'title': final_title,
                        'poster': poster
                    }
                except Exception as e:
                    logger.warning(f"Letterboxd 电影 Top 250 排名 {rank} ({title}): 处理异常: {e}")
                    return None
        
        batch_size = 20
        for batch_start in range(0, total, batch_size):
            batch = movies[batch_start:batch_start + batch_size]
            results = await asyncio.gather(*[process_movie(movie) for movie in batch], return_exceptions=True)
            
            for result in results:
                if isinstance(result, Exception):
                    continue
                if not result:
                    continue
                
                entries.append(
                    {
                        "media_type": "movie",
                        "rank": result["rank"],
                        "tmdb_id": result["tmdb_id"],
                        "title": result["title"],
                        "poster": result["poster"],
                    }
                )
            
            logger.info(f"Letterboxd 电影 Top 250 收集进度: {min(batch_start + batch_size, total)}/{total} 条已处理")
            
            if batch_start + batch_size < total:
                await asyncio.sleep(0.5)
        
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库完成，共 {saved}/{total} 条")
        return saved

    async def scrape_metacritic_top250(self, media_type: str) -> List[Dict]:
        """Metacritic Top 250 榜单"""
        async def scrape_with_browser(browser):
            context = None
            page = None
            try:
                context_options = {
                    'viewport': {'width': 1280, 'height': 720},
                    'user_agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                    'bypass_csp': True,
                    'ignore_https_errors': True,
                    'java_script_enabled': True,
                    'has_touch': False,
                    'is_mobile': False,
                    'locale': 'en-US',
                    'timezone_id': 'America/New_York',
                    'extra_http_headers': {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
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
                page = await context.new_page()
                page.set_default_timeout(60000)
                
                logger.info("访问 Metacritic 首页建立会话...")
                try:
                    await page.goto("https://www.metacritic.com/", wait_until="domcontentloaded", timeout=30000)
                    await asyncio.sleep(2)
                    await page.evaluate("window.scrollTo(0, Math.random() * 500)")
                    await asyncio.sleep(1)
                except Exception as e:
                    logger.warning(f"访问 Metacritic 首页失败: {e}")
                
                all_items = []
                base_url = f"https://www.metacritic.com/browse/{media_type}/"
                
                for page_num in range(1, 12):
                    if page_num == 1:
                        url = base_url
                    else:
                        url = f"{base_url}?page={page_num}"
                    
                    logger.info(f"访问 Metacritic Top 250 ({media_type}) 第 {page_num} 页: {url}")
                    
                    await page.goto(url, wait_until="domcontentloaded", timeout=60000)
                    await asyncio.sleep(2)
                    
                    try:
                        await page.wait_for_load_state("networkidle", timeout=30000)
                    except Exception:
                        await asyncio.sleep(3)
                    
                    page_title = await page.title()
                    logger.debug(f"第 {page_num} 页页面标题: {page_title}")
                    
                    logger.info(f"第 {page_num} 页开始滚动加载内容...")
                    last_count = 0
                    scroll_attempts = 0
                    max_scroll_attempts = 10
                    
                    while scroll_attempts < max_scroll_attempts:
                        page_content = await page.content()
                        card_count_old = len(
                            re.findall(
                                r'<h3[^>]*class="[^"]*c-finderProductCard_titleHeading[^"]*"',
                                page_content,
                            )
                        )
                        card_count_new = len(
                            re.findall(
                                r'<h3[^>]*data-testid="product-title"[^>]*>',
                                page_content,
                            )
                        )
                        card_count = max(card_count_old, card_count_new)
                        logger.debug(f"第 {page_num} 页滚动尝试 {scroll_attempts + 1}: 找到 {card_count} 个卡片")
                        
                        if card_count >= 24:
                            logger.info(f"第 {page_num} 页已加载完成，共 {card_count} 个卡片")
                            break
                        
                        if card_count == last_count and card_count > 0:
                            logger.debug(f"第 {page_num} 页卡片数量未增加，可能已加载完成")
                            await asyncio.sleep(2)
                            page_content = await page.content()
                            new_count_old = len(
                                re.findall(
                                    r'<h3[^>]*class="[^"]*c-finderProductCard_titleHeading[^"]*"',
                                    page_content,
                                )
                            )
                            new_count_new = len(
                                re.findall(
                                    r'<h3[^>]*data-testid="product-title"[^>]*>',
                                    page_content,
                                )
                            )
                            new_count = max(new_count_old, new_count_new)
                            if new_count == card_count:
                                break
                            card_count = new_count
                        
                        last_count = card_count
                        
                        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                        await asyncio.sleep(2)
                        
                        scroll_attempts += 1
                    
                    page_content = await page.content()
                    logger.info(f"第 {page_num} 页从页面源代码提取数据...")

                    page_items_count = 0

                    try:
                        from bs4 import BeautifulSoup

                        soup = BeautifulSoup(page_content, "html.parser")
                        cards = soup.select('div[data-testid="filter-results"]')
                        logger.debug(f"第 {page_num} 页找到 {len(cards)} 个 filter-results 卡片")

                        for card in cards:
                            h3 = card.select_one('h3[data-testid="product-title"]')
                            if not h3:
                                continue

                            spans = h3.find_all("span")
                            if len(spans) < 2:
                                continue

                            rank_text = spans[0].get_text(strip=True)
                            rank_match = re.search(r"(\d+)", rank_text)
                            if not rank_match:
                                continue
                            rank = int(rank_match.group(1))

                            title = spans[1].get_text(strip=True)
                            if not title:
                                continue

                            year = None
                            card_text = card.get_text(" ", strip=True)
                            year_match = re.search(r"\b(19|20)\d{2}\b", card_text)
                            if year_match:
                                try:
                                    year = int(year_match.group(0))
                                except Exception:
                                    year = None

                            all_items.append({"rank": rank, "title": title, "year": year})
                            page_items_count += 1
                    except Exception as e:
                        logger.warning(f"第 {page_num} 页 soup 解析失败，回退旧规则: {e}")

                    if page_items_count == 0:
                        heading_pattern = r'<h3[^>]*class="[^"]*c-finderProductCard_titleHeading[^"]*"[^>]*>(.*?)</h3>'
                        headings = re.findall(heading_pattern, page_content, re.DOTALL)
                        logger.debug(f"第 {page_num} 页(旧规则)找到 {len(headings)} 个标题元素")

                        for heading_html in headings:
                            try:
                                rank_match = re.search(r'<span>(\d+)\.</span>', heading_html)
                                if not rank_match:
                                    continue
                                rank = int(rank_match.group(1))

                                title_match = re.search(r'<span>\d+\.</span>\s*<span>([^<]+)</span>', heading_html)
                                title = None
                                if title_match:
                                    title = title_match.group(1).strip()

                                if not title:
                                    rank_escaped = rank_match.group(0)
                                    card_block_pattern = rf'{re.escape(rank_escaped)}.*?data-title="([^"]+)"'
                                    data_title_match = re.search(card_block_pattern, page_content, re.DOTALL)
                                    if data_title_match:
                                        title = data_title_match.group(1).strip()

                                if not title:
                                    continue

                                year = None
                                heading_start = page_content.find(heading_html)
                                if heading_start != -1:
                                    date_segment = page_content[heading_start:heading_start + 1000]
                                    date_match = re.search(r'<span[^>]*class="[^"]*u-text-uppercase[^"]*"[^>]*>([^<]+)</span>', date_segment)
                                    if date_match:
                                        date_text = date_match.group(1).strip()
                                        year_match = re.search(r'(\d{4})', date_text)
                                        if year_match:
                                            year = int(year_match.group(1))

                                if not year:
                                    title_escaped = re.escape(title)
                                    rank_escaped = rank_match.group(0)
                                    card_block_pattern = rf'(?:data-title="{title_escaped}"|{re.escape(rank_escaped)}.*?<span>{re.escape(title)}</span>).*?<span[^>]*class="[^"]*u-text-uppercase[^"]*"[^>]*>([^<]+)</span>'
                                    date_match = re.search(card_block_pattern, page_content, re.DOTALL)
                                    if date_match:
                                        date_text = date_match.group(1).strip()
                                        year_match = re.search(r'(\d{4})', date_text)
                                        if year_match:
                                            year = int(year_match.group(1))

                                all_items.append({"rank": rank, "title": title, "year": year})
                                page_items_count += 1
                            except Exception as e:
                                logger.warning(f"解析 Metacritic 项目失败: {e}")
                                continue
                    
                    logger.info(f"第 {page_num} 页成功解析 {page_items_count} 个项目")
                    
                    await asyncio.sleep(1)
                
                all_items.sort(key=lambda x: x['rank'])
                
                logger.info(f"Metacritic Top 250 ({media_type}) 获取到 {len(all_items)} 条数据")
                return all_items
                
            except Exception as e:
                logger.error(f"抓取 Metacritic Top 250 ({media_type}) 失败: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return []
            finally:
                if page:
                    await page.close()
                if context:
                    await context.close()
        
        try:
            return await browser_pool.execute_in_browser(scrape_with_browser)
        except Exception as e:
            logger.error(f"Metacritic Top 250 ({media_type}) 抓取失败: {e}")
            return []

    async def update_metacritic_best_movies(self) -> int:
        """Metacritic 史上最佳电影 Top 250"""
        platform = 'Metacritic'
        chart_name = 'Metacritic 史上最佳电影 Top 250'
        items = await self.scrape_metacritic_top250('movie')
        
        if not items:
            logger.error("未能获取到 Metacritic 史上最佳电影 Top 250 数据")
            return 0
        
        matcher = TMDBMatcher(self.db)
        entries: list[dict] = []
        total = len(items[:250])
        
        semaphore = asyncio.Semaphore(10)
        
        async def process_item(item: Dict) -> Optional[Dict]:
            """处理单个项目，返回匹配结果或None"""
            async with semaphore:
                rank = item.get('rank')
                title = item.get('title') or ''
                year = item.get('year')

                if not title:
                    logger.warning(f"Metacritic 史上最佳电影 Top 250 排名 {rank}: 缺少标题")
                    return None
                
                try:
                    tmdb_id = await matcher.match_by_title_and_year(title, 'movie', str(year) if year else None)
                    if not tmdb_id:
                        logger.warning(f"Metacritic 史上最佳电影 Top 250 排名 {rank} ({title}): 未匹配到 TMDB")
                        return None
                    
                    info = await matcher.get_tmdb_info(tmdb_id, 'movie')
                    if not info:
                        return None
                    
                    return {
                        'rank': rank,
                        'tmdb_id': tmdb_id,
                        'title': self._safe_get_title(info, title),
                        'poster': info.get('poster_url', ''),
                        'media_type': 'movie'
                    }
                except Exception as e:
                    logger.warning(f"Metacritic 史上最佳电影 Top 250 排名 {rank} ({title}): 匹配失败: {e}")
                    return None
        
        batch_size = 30
        for batch_start in range(0, total, batch_size):
            batch = items[batch_start:batch_start + batch_size]
            results = await asyncio.gather(*[process_item(item) for item in batch], return_exceptions=True)
            
            for result in results:
                if isinstance(result, Exception):
                    continue
                if not result:
                    continue
                
                entries.append(
                    {
                        "media_type": "movie",
                        "rank": result["rank"],
                        "tmdb_id": result["tmdb_id"],
                        "title": result["title"],
                        "poster": result["poster"],
                    }
                )
            
            logger.info(f"Metacritic 史上最佳电影 Top 250 收集进度: {min(batch_start + batch_size, total)}/{total} 条已处理")
            
            if batch_start + batch_size < total:
                await asyncio.sleep(0.3)
        
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库完成，共 {saved}/{total} 条")
        return saved

    async def update_metacritic_best_tv(self) -> int:
        """Metacritic 史上最佳剧集 Top 250"""
        platform = 'Metacritic'
        chart_name = 'Metacritic 史上最佳剧集 Top 250'
        items = await self.scrape_metacritic_top250('tv')
        
        if not items:
            logger.error("未能获取到 Metacritic 史上最佳剧集 Top 250 数据")
            return 0
        
        matcher = TMDBMatcher(self.db)
        entries: list[dict] = []
        total = len(items[:250])
        
        semaphore = asyncio.Semaphore(10)
        
        async def process_item(item: Dict) -> Optional[Dict]:
            """处理单个项目，返回匹配结果或None"""
            async with semaphore:
                rank = item.get('rank')
                title = item.get('title') or ''
                year = item.get('year')

                if not title:
                    logger.warning(f"Metacritic 史上最佳剧集 Top 250 排名 {rank}: 缺少标题")
                    return None
                
                try:
                    tmdb_id = await matcher.match_by_title_and_year(title, 'tv', str(year) if year else None)
                    if not tmdb_id:
                        logger.warning(f"Metacritic 史上最佳剧集 Top 250 排名 {rank} ({title}): 未匹配到 TMDB")
                        return None
                    
                    info = await matcher.get_tmdb_info(tmdb_id, 'tv')
                    if not info:
                        return None
                    
                    return {
                        'rank': rank,
                        'tmdb_id': tmdb_id,
                        'title': self._safe_get_title(info, title),
                        'poster': info.get('poster_url', ''),
                        'media_type': 'tv'
                    }
                except Exception as e:
                    logger.warning(f"Metacritic 史上最佳剧集 Top 250 排名 {rank} ({title}): 匹配失败: {e}")
                    return None
        
        batch_size = 30
        for batch_start in range(0, total, batch_size):
            batch = items[batch_start:batch_start + batch_size]
            results = await asyncio.gather(*[process_item(item) for item in batch], return_exceptions=True)
            
            for result in results:
                if isinstance(result, Exception):
                    continue
                if not result:
                    continue
                
                entries.append(
                    {
                        "media_type": "tv",
                        "rank": result["rank"],
                        "tmdb_id": result["tmdb_id"],
                        "title": result["title"],
                        "poster": result["poster"],
                    }
                )
            
            logger.info(f"Metacritic 史上最佳剧集 Top 250 收集进度: {min(batch_start + batch_size, total)}/{total} 条已处理")
            
            if batch_start + batch_size < total:
                await asyncio.sleep(0.3)
        
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库完成，共 {saved}/{total} 条")
        return saved

    async def update_trakt_movies_weekly(self) -> int:
        """Trakt 上周电影 Top 榜"""
        platform = 'Trakt'
        chart_name = '上周电影 Top 榜'
        import urllib3, requests
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        headers = {
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': TRAKT_CLIENT_ID,
            'User-Agent': 'Mozilla/5.0'
        }
        r = requests.get(f'{TRAKT_BASE_URL}/movies/watched/weekly', params={'limit':10}, headers=headers, timeout=25, verify=False)
        if r.status_code != 200:
            return 0
        from chart_scrapers import TMDBMatcher
        matcher = TMDBMatcher(self.db)
        entries: list[dict] = []
        for idx, it in enumerate(r.json()[:10], 1):
            title = (it.get('movie') or {}).get('title') or ''
            year = (it.get('movie') or {}).get('year')
            match = None
            for attempt in range(3):
                try:
                    tmdb_id = await matcher.match_by_title_and_year(title, 'movie', str(year) if year else None)
                    if not tmdb_id:
                        raise RuntimeError('no id')
                    info = await matcher.get_tmdb_info(tmdb_id, 'movie')
                    if not info:
                        raise RuntimeError('no info')
                    match = {'tmdb_id': tmdb_id, 'title': self._safe_get_title(info, title), 'poster': info.get('poster_url',''), 'media_type': 'movie'}
                    break
                except Exception:
                    if attempt<2:
                        await asyncio.sleep(2**attempt)
            if not match:
                continue
            
            final_title = match.get('title') or title or f"TMDB-{match['tmdb_id']}"
            entries.append(
                {
                    "media_type": match.get("media_type", "movie"),
                    "rank": idx,
                    "tmdb_id": match["tmdb_id"],
                    "title": final_title,
                    "poster": match.get("poster", ""),
                }
            )
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved

    async def update_trakt_shows_weekly(self) -> int:
        """Trakt 上周剧集 Top 榜"""
        platform = 'Trakt'
        chart_name = '上周剧集 Top 榜'
        import urllib3, requests
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        headers = {
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': TRAKT_CLIENT_ID,
            'User-Agent': 'Mozilla/5.0'
        }
        r = requests.get(f'{TRAKT_BASE_URL}/shows/watched/weekly', params={'limit':10}, headers=headers, timeout=25, verify=False)
        if r.status_code != 200:
            return 0
        from chart_scrapers import TMDBMatcher
        matcher = TMDBMatcher(self.db)
        entries: list[dict] = []
        for idx, it in enumerate(r.json()[:10], 1):
            title = (it.get('show') or {}).get('title') or ''
            year = (it.get('show') or {}).get('year')
            match = None
            for attempt in range(3):
                try:
                    tmdb_id = await matcher.match_by_title_and_year(title, 'tv', str(year) if year else None)
                    if not tmdb_id:
                        raise RuntimeError('no id')
                    info = await matcher.get_tmdb_info(tmdb_id, 'tv')
                    if not info:
                        raise RuntimeError('no info')
                    match = {'tmdb_id': tmdb_id, 'title': self._safe_get_title(info, title), 'poster': info.get('poster_url',''), 'media_type': 'tv'}
                    break
                except Exception:
                    if attempt<2:
                        await asyncio.sleep(2**attempt)
            if not match:
                continue
            
            final_title = match.get('title') or title or f"TMDB-{match['tmdb_id']}"
            entries.append(
                {
                    "media_type": match.get("media_type", "tv"),
                    "rank": idx,
                    "tmdb_id": match["tmdb_id"],
                    "title": final_title,
                    "poster": match.get("poster", ""),
                }
            )
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved

    async def update_imdb_top10(self) -> int:
        """IMDb 本周 Top 10"""
        platform = 'IMDb'
        chart_name = 'IMDb 本周 Top 10'
        matcher = TMDBMatcher(self.db)
        items = await self.scrape_imdb_top_10()
        entries: list[dict] = []
        for idx, it in enumerate(items[:10], 1):
            title = it.get('title') or ''
            imdb_id = it.get('imdb_id') or ''
            match = None
            if imdb_id:
                match = await matcher.match_imdb_with_tmdb(imdb_id, title, 'both')
            if not match:
                continue
            media_type = match.get('media_type') or 'movie'
            entries.append(
                {
                    "media_type": media_type,
                    "rank": idx,
                    "tmdb_id": match["tmdb_id"],
                    "title": match.get("title", title),
                    "poster": match.get("poster", ""),
                }
            )
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved

    async def update_douban_weekly_movie(self) -> int:
        """豆瓣 一周口碑榜"""
        platform = '豆瓣'
        chart_name = '一周口碑榜'
        matcher = TMDBMatcher(self.db)
        items = await self.scrape_douban_weekly_movie_chart()
        entries: list[dict] = []
        rank = 1
        for it in items[:10]:
            title = it.get('title') or ''
            douban_id = it.get('douban_id') or ''
            match = None
            
            imdb_id = await self.get_douban_imdb_id(douban_id)
            if imdb_id:
                logger.info(f"尝试用IMDb ID匹配: {title} (IMDb: {imdb_id})")
                match = await matcher.match_imdb_with_tmdb(imdb_id, title, 'movie')
                if match:
                    logger.info(f"✅ IMDb ID匹配成功: {title}")
            
            if not match:
                original_title = await matcher.extract_douban_original_title(douban_id)
                if original_title:
                    logger.info(f"尝试用原标题匹配: {title} -> {original_title}")
                    tmdb_id = await matcher.match_by_title_and_year(original_title, 'movie')
                    if tmdb_id:
                        info = await matcher.get_tmdb_info(tmdb_id, 'movie')
                        if info:
                            match = {'tmdb_id': tmdb_id, 'title': self._safe_get_title(info, title), 'poster': info.get('poster_url',''), 'media_type': 'movie'}
                            logger.info(f"✅ 原标题匹配成功: {original_title}")
            
            if not match:
                logger.info(f"尝试用中文标题匹配: {title}")
                mid = await matcher.match_by_title_and_year(title, 'movie')
                if mid:
                    info = await matcher.get_tmdb_info(mid, 'movie')
                    if info:
                        match = {'tmdb_id': mid, 'title': self._safe_get_title(info, title), 'poster': info.get('poster_url',''), 'media_type': 'movie'}
                        logger.info(f"✅ 中文标题匹配成功: {title}")
            
            if not match:
                logger.warning(f"❌ 所有匹配方式都失败: {title}")
                rank += 1; continue
            
            entries.append(
                {
                    "media_type": match.get("media_type", "movie"),
                    "rank": rank,
                    "tmdb_id": match["tmdb_id"],
                    "title": match.get("title", title),
                    "poster": match.get("poster", ""),
                }
            )
            rank += 1
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved

    async def update_douban_weekly_chinese_tv(self) -> int:
        """豆瓣 一周华语剧集口碑榜"""
        platform = '豆瓣'
        chart_name = '一周华语剧集口碑榜'
        matcher = TMDBMatcher(self.db)
        items = await self.scrape_douban_weekly_chinese_tv_chart()
        entries: list[dict] = []; rank = 1
        for it in items[:10]:
            title = it.get('title') or ''
            tmdb_id = await matcher.match_by_title_and_year(title, 'tv')
            match = None
            if tmdb_id:
                info = await matcher.get_tmdb_info(tmdb_id, 'tv')
                if info:
                    match = {'tmdb_id': tmdb_id, 'title': self._safe_get_title(info, title), 'poster': info.get('poster_url',''), 'media_type': 'tv'}
            if not match:
                rank += 1; continue
            
            entries.append(
                {
                    "media_type": match.get("media_type", "tv"),
                    "rank": rank,
                    "tmdb_id": match["tmdb_id"],
                    "title": match.get("title", title),
                    "poster": match.get("poster", ""),
                }
            )
            rank += 1
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved

    async def update_douban_weekly_global_tv(self) -> int:
        """豆瓣 一周全球剧集口碑榜"""
        platform = '豆瓣'
        chart_name = '一周全球剧集口碑榜'
        matcher = TMDBMatcher(self.db)
        items = await self.scrape_douban_weekly_global_tv_chart()
        entries: list[dict] = []; rank = 1
        for it in items[:10]:
            title = it.get('title') or ''
            douban_id = it.get('douban_id') or ''
            match = None
            original_title = None
            
            logger.debug(f"处理: {title} (豆瓣ID: {douban_id})")
            
            original_title = await matcher.extract_douban_original_title(douban_id)
            if original_title:
                logger.debug(f"提取到原名: {original_title}")
            
            if original_title:
                logger.debug(f"用原名匹配: {original_title}")
                tmdb_id = await matcher.match_by_title_and_year(original_title, 'tv')
                if tmdb_id:
                    info = await matcher.get_tmdb_info(tmdb_id, 'tv')
                    if info:
                        match = {'tmdb_id': tmdb_id, 'title': self._safe_get_title(info, original_title), 'poster': info.get('poster_url',''), 'media_type': 'tv'}
                        logger.info(f"✅ 原名匹配成功: {original_title} -> {match['title']}")
            
            if not match:
                logger.debug(f"回退中文名匹配: {title}")
                tmdb_id = await matcher.match_by_title_and_year(title, 'tv')
                if tmdb_id:
                    info = await matcher.get_tmdb_info(tmdb_id, 'tv')
                    if info:
                        match = {'tmdb_id': tmdb_id, 'title': self._safe_get_title(info, title), 'poster': info.get('poster_url',''), 'media_type': 'tv'}
                        logger.info(f"✅ 中文名匹配成功: {title} -> {match['title']}")
            if not match:
                rank += 1; continue
            entries.append(
                {
                    "media_type": match.get("media_type", "tv"),
                    "rank": rank,
                    "tmdb_id": match["tmdb_id"],
                    "title": match.get("title", title),
                    "poster": match.get("poster", ""),
                }
            )
            rank += 1
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved
    
    async def update_rotten_tv(self) -> int:
        """Rotten Tomatoes 本周热门剧集"""
        platform = 'Rotten Tomatoes'
        chart_name = '本周热门剧集'
        matcher = TMDBMatcher(self.db)
        url = 'https://www.rottentomatoes.com/browse/tv_series_browse/sort:popular'
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                logger.info(f"Rotten Tomatoes 本周热门剧集 抓取尝试 {attempt + 1}/{max_retries}")
                items = await self._rt_extract_itemlist(url, 'TVSeries')
                if not items:
                    raise Exception("未获取到 Rotten Tomatoes 本周热门剧集 榜单数据")
                break
            except Exception as e:
                logger.warning(f"Rotten Tomatoes 本周热门剧集 抓取失败 (尝试 {attempt + 1}/{max_retries}): {e}")
                if attempt == max_retries - 1:
                    logger.error("Rotten Tomatoes 本周热门剧集 抓取最终失败")
                    return 0
                await asyncio.sleep(5 * (attempt + 1))
        
        entries: list[dict] = []
        rank = 1
        for it in items[:10]:
            title = it.get('name') or ''
            year = it.get('year')
            match = None
            for attempt in range(3):
                try:
                    tmdb_id = await matcher.match_by_title_and_year(title, 'tv', str(year) if year else None)
                    if not tmdb_id:
                        raise RuntimeError('no tmdb')
                    info = await matcher.get_tmdb_info(tmdb_id, 'tv')
                    if not info:
                        raise RuntimeError('no info')
                    match = {
                        'tmdb_id': tmdb_id,
                        'title': self._safe_get_title(info, title),
                        'poster': info.get('poster_url', ''),
                        'media_type': 'tv'
                    }
                    break
                except Exception:
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)
            if not match:
                logger.warning(f"Rotten Tomatoes 本周热门剧集 未匹配: {title}")
                rank += 1
                continue
            
            final_title = match.get('title') or title or f"TMDB-{match['tmdb_id']}"
            entries.append(
                {
                    "media_type": match.get("media_type", "tv"),
                    "rank": rank,
                    "tmdb_id": match["tmdb_id"],
                    "title": final_title,
                    "poster": match.get("poster", ""),
                }
            )
            rank += 1
        entries.sort(key=lambda x: x["rank"])
        saved = self._replace_chart_snapshot(platform, chart_name, entries)
        logger.info(f"{platform} {chart_name} 入库 {saved} 条")
        return saved
    
    async def scrape_metacritic_trending_movies(self) -> List[Dict]:
        """Metacritic 本周趋势电影"""
        async def scrape_with_browser(browser):
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )
            page = await context.new_page()
            try:
                await page.goto("https://www.metacritic.com/", wait_until="domcontentloaded", timeout=60000)

                section_selector = 'div.front-door__trending-movies-this-week'
                await page.wait_for_selector(section_selector, timeout=30000)
                section = await page.query_selector(section_selector)
                if not section:
                    logger.warning("未找到 Metacritic 本周趋势电影 板块")
                    return []

                await page.wait_for_selector(f'{section_selector} [data-testid="product-card"]', timeout=10000)
                movie_cards = await section.query_selector_all('[data-testid="product-card"]')
                logger.info(f"在 Metacritic 本周趋势电影 板块内找到 {len(movie_cards)} 个卡片")

                results = []
                for i, card in enumerate(movie_cards[:10], 1):
                    try:
                        title_elem = await card.query_selector('.product-card-link__title')
                        if not title_elem:
                            continue
                        title = await title_elem.inner_text()

                        link_elem = await card.query_selector('a[data-testid="product-card-content"]')
                        if not link_elem:
                            continue
                        url = await link_elem.get_attribute('href')
                        if not url:
                            continue
                        if not url.startswith('http'):
                            url = f"https://www.metacritic.com{url}"

                        metacritic_id = re.search(r'/movie/([^/]+)/', url)
                        if metacritic_id:
                            results.append({
                                'rank': i,
                                'title': title.strip(),
                                'metacritic_id': metacritic_id.group(1),
                                'url': url
                            })
                    except Exception as e:
                        logger.error(f"处理 Metacritic 本周趋势电影 卡出错: {e}")
                        continue

                logger.info(f" Metacritic 本周趋势电影 最终获取到 {len(results)} 个项目")
                return results
            except Exception as e:
                logger.error(f"抓取 Metacritic 本周趋势电影 时发生错误: {e}", exc_info=True)
                return []
            finally:
                await page.close()
                await context.close()

        return await browser_pool.execute_in_browser(scrape_with_browser)

    async def scrape_metacritic_trending_shows(self) -> List[Dict]:
        """Metacritic 本周趋势剧集"""
        async def scrape_with_browser(browser):
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )
            page = await context.new_page()
            try:
                await page.goto("https://www.metacritic.com/", wait_until="domcontentloaded", timeout=60000)

                section_selector = 'div.front-door__trending-tv-shows-this-week'
                await page.wait_for_selector(section_selector, timeout=30000)
                section = await page.query_selector(section_selector)
                if not section:
                    logger.warning("未找到 Metacritic 本周趋势剧集 板块")
                    return []

                await page.wait_for_selector(f'{section_selector} [data-testid="product-card"]', timeout=10000)
                show_cards = await section.query_selector_all('[data-testid="product-card"]')
                logger.info(f"在 Metacritic 本周趋势剧集 板块内找到 {len(show_cards)} 个卡片")

                results = []
                for i, card in enumerate(show_cards[:10], 1):
                    try:
                        title_elem = await card.query_selector('.product-card-link__title')
                        if not title_elem:
                            continue
                        title = await title_elem.inner_text()

                        link_elem = await card.query_selector('a[data-testid="product-card-content"]')
                        if not link_elem:
                            continue
                        url = await link_elem.get_attribute('href')
                        if not url:
                            continue
                        if not url.startswith('http'):
                            url = f"https://www.metacritic.com{url}"

                        metacritic_id = re.search(r'/tv/([^/]+)/', url)
                        if metacritic_id:
                            results.append({
                                'rank': i,
                                'title': title.strip(),
                                'metacritic_id': metacritic_id.group(1),
                                'url': url
                            })
                    except Exception as e:
                        logger.error(f"处理 Metacritic 本周趋势剧集 卡出错: {e}")
                        continue

                logger.info(f" Metacritic 本周趋势剧集 最终获取到 {len(results)} 个项目")
                return results
            except Exception as e:
                logger.error(f"抓取 Metacritic 本周趋势剧集 时发生错误: {e}", exc_info=True)
                return []
            finally:
                await page.close()
                await context.close()
                
        return await browser_pool.execute_in_browser(scrape_with_browser)

class TMDBMatcher:
    def __init__(self, db: Session):
        self.db = db
    
    @staticmethod
    def _safe_get_title(info: Dict, fallback_title: str = '') -> str:
        """安全获取标题"""
        zh_title = (info.get('zh_title') or '').strip()
        tmdb_title = (info.get('title') or '').strip()
        tmdb_name = (info.get('name') or '').strip()
        return zh_title or tmdb_title or tmdb_name or fallback_title
        
    async def match_imdb_with_tmdb(self, imdb_id: str, title: str, media_type: str, max_retries: int = 3) -> Optional[Dict]:
        """通过IMDB ID匹配TMDB ID"""
        for attempt in range(max_retries):
            try:
                logger.info(f"尝试匹配IMDB ID {imdb_id} ({title}) - 第 {attempt + 1} 次尝试")
                
                tmdb_id = None
                
                logger.info(f"使用IMDB ID搜索: {imdb_id}")
                match_result = await self.match_by_imdb_id(imdb_id, media_type)
                
                if match_result:
                    if isinstance(match_result, dict):
                        tmdb_id = match_result['tmdb_id']
                        actual_media_type = match_result['media_type']
                    else:
                        tmdb_id = match_result
                        actual_media_type = media_type
                else:
                    tmdb_id = None
                    actual_media_type = media_type
                
                if tmdb_id:
                    tmdb_info = await self.get_tmdb_info(tmdb_id, actual_media_type)
                    if tmdb_info:
                        final_title = self._safe_get_title(tmdb_info, title)
                        logger.info(f"成功匹配: {title} -> TMDB ID: {tmdb_id}, 中文标题: {final_title}")
                        return {
                            'tmdb_id': tmdb_id,
                            'title': final_title,
                            'poster': tmdb_info.get('poster_url', ''),
                            'media_type': actual_media_type
                        }
                    else:
                        logger.warning(f"获取TMDB信息失败，但TMDB ID存在: {tmdb_id}")
                        return {
                            'tmdb_id': tmdb_id,
                            'title': title,
                            'poster': "",
                            'media_type': actual_media_type
                        }
                
                if not tmdb_id:
                    logger.info(f"IMDB ID匹配失败，尝试标题搜索: {title}")
                    tmdb_id = await self.match_by_title_and_year(title, media_type)
                    if tmdb_id:
                        tmdb_info = await self.get_tmdb_info(tmdb_id, media_type)
                        if tmdb_info:
                            final_title = self._safe_get_title(tmdb_info, title)
                            logger.info(f"通过标题匹配成功: {title} -> TMDB ID: {tmdb_id}, 中文标题: {final_title}")
                            return {
                                'tmdb_id': tmdb_id,
                                'title': final_title,
                                'poster': tmdb_info.get('poster_url', ''),
                                'media_type': media_type
                            }
                
                if attempt < max_retries - 1:
                    logger.warning(f"第 {attempt + 1} 次尝试失败，等待 {2 ** attempt} 秒后重试...")
                    await asyncio.sleep(2 ** attempt)
                else:
                    logger.error(f"经过 {max_retries} 次尝试后，仍无法匹配: {title}")
                    return None
                    
            except Exception as e:
                logger.error(f"IMDB匹配失败 (第 {attempt + 1} 次尝试): {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    return None
            
        return None
        
    async def match_douban_with_tmdb(self, douban_id: str, title: str, media_type: str, max_retries: int = 3) -> Optional[Dict]:
        """通过豆瓣ID和标题匹配TMDB ID"""
        for attempt in range(max_retries):
            try:
                logger.info(f"尝试匹配豆瓣ID {douban_id} ({title}) - 第 {attempt + 1} 次尝试")
                
                tmdb_id = None
                
                original_title = await self.extract_douban_original_title(douban_id)
                
                if original_title:
                    logger.info(f"使用原名搜索: {original_title}")
                    tmdb_id = await self.match_by_title_and_year(original_title, media_type)
                    if tmdb_id:
                        logger.info(f"通过原名匹配成功: {title} -> {original_title} (ID: {tmdb_id})")
                
                if not tmdb_id:
                    logger.info(f"使用中文标题搜索: {title}")
                    tmdb_id = await self.match_by_title_and_year(title, media_type)
                
                if not tmdb_id and media_type == "tv" and ("第二季" in title or "Season 2" in title):
                    first_season_title = title.replace("第二季", "").replace("Season 2", "").strip()
                    logger.info(f"尝试第一季标题搜索: {first_season_title}")
                    tmdb_id = await self.match_by_title_and_year(first_season_title, media_type)
                    if tmdb_id:
                        logger.info(f"通过第一季标题匹配成功: {title} -> {first_season_title} (ID: {tmdb_id})")
                
                if tmdb_id:
                    tmdb_info = await self.get_tmdb_info(tmdb_id, media_type)
                    if tmdb_info:
                        final_title = tmdb_info.get('zh_title') or tmdb_info.get('title') or tmdb_info.get('name', title)
                        logger.info(f"成功匹配: {title} -> TMDB ID: {tmdb_id}, 中文标题: {final_title}")
                        return {
                            'tmdb_id': tmdb_id,
                            'title': final_title,
                            'poster': tmdb_info.get('poster_url', '')
                        }
                    else:
                        logger.warning(f"获取TMDB信息失败，但TMDB ID存在: {tmdb_id}")
                        return {
                            'tmdb_id': tmdb_id,
                            'title': title,
                            'poster': ""
                        }
                
                if attempt < max_retries - 1:
                    logger.warning(f"第 {attempt + 1} 次尝试失败，等待 {2 ** attempt} 秒后重试...")
                    await asyncio.sleep(2 ** attempt)
                else:
                    logger.error(f"经过 {max_retries} 次尝试后，仍无法匹配: {title}")
                    return None
                    
            except Exception as e:
                logger.error(f"豆瓣匹配失败 (第 {attempt + 1} 次尝试): {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    return None
        
        return None
    
    async def extract_douban_original_title(self, douban_id: str) -> Optional[str]:
        """从豆瓣详情页 JSON-LD 和 HTML 中提取原名"""
        try:
            import requests, urllib3, json
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
            }
            resp = requests.get(f"https://movie.douban.com/subject/{douban_id}/", headers=headers, timeout=20, verify=False)
            
            if resp.status_code != 200:
                return None
                
            html = resp.text
            original_title = None
            
            ld_blocks = re.findall(r'<script[^>]*type=\"application/ld\+json\"[^>]*>([\s\S]*?)</script>', html)
            
            for blk in ld_blocks:
                try:
                    data = json.loads(blk.strip())
                    if isinstance(data, dict):
                        name_field = data.get('name')
                        if isinstance(name_field, str) and name_field.strip():
                            patterns = [
                                r'^[^\s]+\s+[^\s]*\s+([A-Za-z][A-Za-z\s]+?)\s+Season\s+\d+',
                                r'^[^\s]+\s+([A-Za-z\uAC00-\uD7A3][A-Za-z\uAC00-\uD7A3\s]*?)$',
                                r'^[^\s]+[^\s]*\s+([A-Za-z][A-Za-z\s:]+?)$'
                            ]
                            
                            for pattern in patterns:
                                match = re.search(pattern, name_field.strip())
                                if match:
                                    candidate = match.group(1).strip()
                                    if candidate.lower() not in ('season', 'part', 'the', 'a', 'an'):
                                        original_title = candidate
                                        break
                                                    
                            if not original_title:
                                tokens = re.split(r'[\s/|，,、:]+', name_field.strip())
                                non_chinese_tokens = []
                                for token in tokens:
                                    token = token.strip()
                                    if re.search(r'[\u4e00-\u9fff]', token):
                                        continue
                                    if token.lower() in ('season', 'part', '第二季', '第三季'):
                                        continue
                                    if re.match(r'^\d+$', token):
                                        continue
                                    if re.search(r'[A-Za-z\uAC00-\uD7A3]', token) and len(token) > 1:
                                        non_chinese_tokens.append(token)
                                
                                if non_chinese_tokens:
                                    original_title = ' '.join(non_chinese_tokens)
                                    if original_title:
                                        break
                except Exception:
                    continue
            
            if not original_title:
                m = re.search(r'<span class="pl">原名:</span>\s*([^<]+)<br\s*/?>', html)
                if m:
                    cand = m.group(1).strip()
                    if re.search(r'[A-Za-z\uAC00-\uD7A3]', cand):
                        original_title = cand
                
                if not original_title:
                    m2 = re.search(r'<span class="pl">又名:</span>\s*([^<]+)<br\s*/?>', html)
                    if m2:
                        aka_raw = m2.group(1)
                        for part in re.split(r'[，,/]+', aka_raw):
                            part = part.strip()
                            if re.search(r'[A-Za-z\uAC00-\uD7A3]', part):
                                original_title = part
                                break
            
            return original_title
        except Exception:
            return None
    
    def clean_title_for_search(self, title: str) -> str:
        """清理标题"""
        import re
        
        season_patterns = [
            r'\s+第[一二三四五六七八九十\d]+季\s*$',
            r'\s+Season\s+\d+\s*$',
            r'\s+S\d+\s*$',
            r'\s+第[一二三四五六七八九十\d]+部\s*$',
            r'\s+Part\s+\d+\s*$',
            r'\s+第[一二三四五六七八九十\d]+集\s*$',
            r'\s+Episode\s+\d+\s*$',
            r'\s+E\d+\s*$',
        ]
        
        cleaned_title = title
        for pattern in season_patterns:
            cleaned_title = re.sub(pattern, '', cleaned_title, flags=re.IGNORECASE)
        
        re_release_patterns = [
            r'\s*\(re-release\)\s*',
            r'\s*\(re-issue\)\s*',
            r'\s*\(restored\)\s*',
            r'\s*\(restoration\)\s*',
            r'\s*\(restored version\)\s*',
            r'\s*\(director\'?s cut\)\s*',
            r'\s*\(extended cut\)\s*',
            r'\s*\(uncut\)\s*',
            r'\s*\(uncensored\)\s*',
        ]
        
        for pattern in re_release_patterns:
            cleaned_title = re.sub(pattern, '', cleaned_title, flags=re.IGNORECASE)
        
        cleaned_title = cleaned_title.strip()
        
        logger.info(f"标题清理: '{title}' -> '{cleaned_title}'")
        return cleaned_title

    async def match_by_imdb_id(self, imdb_id: str, media_type: str) -> Optional[int]:
        """通过IMDB ID匹配TMDB ID"""
        try:
            import requests
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            
            find_url = f"{TMDB_API_BASE_URL}/find/{imdb_id}?api_key={TMDB_API_KEY}&external_source=imdb_id"
                
            logger.info(f"TMDB API URL: {find_url}")
            response = requests.get(find_url, verify=False)
            logger.info(f"TMDB API响应状态: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                
                if media_type == 'both':
                    movie_results = data.get('movie_results', [])
                    if movie_results:
                        tmdb_id = movie_results[0].get('id')
                        logger.info(f"通过IMDB ID {imdb_id} 找到TMDB电影ID: {tmdb_id}")
                        return {'tmdb_id': tmdb_id, 'media_type': 'movie'}
                    
                    tv_results = data.get('tv_results', [])
                    if tv_results:
                        tmdb_id = tv_results[0].get('id')
                        logger.info(f"通过IMDB ID {imdb_id} 找到TMDB电视剧ID: {tmdb_id}")
                        return {'tmdb_id': tmdb_id, 'media_type': 'tv'}
                    
                    logger.warning(f"IMDB ID {imdb_id} 在TMDB中未找到任何匹配")
                    return None
                else:
                    results = data.get(f'{media_type}_results', [])
                    if results:
                        tmdb_id = results[0].get('id')
                        logger.info(f"通过IMDB ID {imdb_id} 找到TMDB ID: {tmdb_id}")
                        return tmdb_id
                    else:
                        logger.warning(f"IMDB ID {imdb_id} 在TMDB中未找到匹配的{media_type}")
                        return None
            else:
                logger.error(f"TMDB find API请求失败: {response.status_code}")
                if response.status_code == 404:
                    error_data = response.text
                    logger.error(f"404错误详情: {error_data}")
                return None
                        
        except Exception as e:
            logger.error(f"通过IMDB ID匹配失败: {e}")
            return None

    async def match_by_title_and_year(self, title: str, media_type: str, year: str = None) -> Optional[int]:
        """通过标题和年份匹配TMDB ID"""
        try:
            import requests
            import urllib3
            from fuzzywuzzy import fuzz
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

            search_title = self.clean_title_for_search(title)

            headers = {"Authorization": f"Bearer {TMDB_TOKEN}", "accept": "application/json"}

            def do_search(lang: str | None):
                base = f"{TMDB_API_BASE_URL}/search/{media_type}?query={requests.utils.quote(search_title)}"
                if lang:
                    base += f"&language={lang}"
                if year:
                    base += f"&year={year}"
                resp = requests.get(base, headers=headers, verify=False, timeout=20)
                if resp.status_code != 200:
                    return []
                data = resp.json()
                return data.get("results", [])

            results_zh = do_search("zh-CN")
            results_en = [] if results_zh else do_search("en-US")
            results_any = [] if (results_zh or results_en) else do_search(None)
            results = results_zh or results_en or results_any

            if not results:
                return None

            best_match = None
            best_score = 0
            for result in results:
                result_title = result.get("name" if media_type == "tv" else "title", "")
                original_title = result.get("original_name" if media_type == "tv" else "original_title", "")
                result_year = (result.get("first_air_date" if media_type == "tv" else "release_date", "") or "")[:4]

                title_score = fuzz.ratio(search_title.lower(), result_title.lower()) if result_title else 0
                original_score = fuzz.ratio(search_title.lower(), original_title.lower()) if original_title else 0
                max_title_score = max(title_score, original_score)

                year_bonus = 0
                if year and result_year:
                    if result_year == year:
                        year_bonus = 10
                    elif result_year.isdigit() and abs(int(result_year) - int(year)) <= 2:
                        year_bonus = 5

                recency_bonus = 0
                if result_year.isdigit() and int(result_year) >= 2020:
                    recency_bonus = 3

                total_score = (max_title_score * (1.4 if media_type == "tv" else 1.0)) + year_bonus + recency_bonus
                if total_score > best_score:
                    best_score = total_score
                    best_match = result

            if best_match and best_score >= 60:
                return int(best_match.get("id"))

            if year:
                results_relaxed = do_search(None)
                for result in results_relaxed:
                    result_title = result.get("name" if media_type == "tv" else "title", "")
                    if fuzz.partial_ratio(search_title.lower(), (result_title or "").lower()) >= 60:
                        return int(result.get("id"))

            return None
        except Exception as e:
            logger.error(f"通过标题匹配失败: {e}")
            return None
    
    async def get_tmdb_info(self, tmdb_id: int, media_type: str, max_retries: int = 3) -> Optional[Dict]:
        """获取TMDB详细信息"""
        for attempt in range(max_retries):
            try:
                import requests
                import urllib3
                urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                
                endpoint = f"{TMDB_API_BASE_URL}/{media_type}/{tmdb_id}?api_key={TMDB_API_KEY}&language=en-US&append_to_response=credits,external_ids"
                response = requests.get(endpoint, verify=False)
                
                if response.status_code == 200:
                    en_data = response.json()
                else:
                    logger.error(f"获取{media_type}信息失败，状态码: {response.status_code}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    return None

                if not en_data:
                    logger.error("API返回的数据为空")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    return None
                    
                zh_endpoint = endpoint.replace("language=en-US", "language=zh-CN")
                zh_response = requests.get(zh_endpoint, verify=False)
                zh_data = zh_response.json() if zh_response.status_code == 200 else en_data
                
                if media_type == "movie":
                    title = en_data.get("title", "")
                    original_title = en_data.get("original_title", "")
                    zh_title = zh_data.get("title", "")
                    year = en_data.get("release_date", "")[:4] if en_data.get("release_date") else ""
                else:
                    title = en_data.get("name", "")
                    original_title = en_data.get("original_name", "")
                    zh_title = zh_data.get("name", "")
                    year = en_data.get("first_air_date", "")[:4] if en_data.get("first_air_date") else ""
                
                poster_path = en_data.get("poster_path", "")
                poster_url = f"https://tmdb.ratefuse.cn/t/p/w500{poster_path}" if poster_path else ""
                
                result = {
                    "type": media_type,
                    "title": title,
                    "original_title": original_title,
                    "zh_title": zh_title,
                    "year": year,
                    "tmdb_id": str(tmdb_id),
                    "imdb_id": en_data.get("imdb_id") or en_data.get("external_ids", {}).get("imdb_id", ""),
                    "poster_path": poster_path,
                    "poster_url": poster_url
                }
                
                logger.info(f"成功获取TMDB信息: {title} (ID: {tmdb_id})")
                return result
                
            except ImportError:
                logger.warning("aiohttp库未安装，无法进行TMDB API调用")
                return None
            except Exception as e:
                logger.error(f"获取TMDB信息失败 (第 {attempt + 1} 次尝试): {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    return None
        
        return None

class TelegramNotifier:
    def __init__(self):
        self.bot_token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
        self.chat_id = (os.getenv("TELEGRAM_NOTIFY_CHAT_ID") or "").strip()
        if not self.chat_id:
            admins = (os.getenv("TELEGRAM_ADMIN_CHAT_IDS") or "").split(",")
            if admins and admins[0].strip():
                self.chat_id = admins[0].strip()
        self.enabled = bool(self.bot_token and self.chat_id)
        
        if self.enabled:
            logger.info("Telegram通知已启用")
        else:
            logger.warning("Telegram通知未配置")
    
    async def send_message(self, message: str, parse_mode: str = "Markdown") -> bool:
        """发送Telegram消息"""
        if not self.enabled:
            logger.debug("Telegram通知未启用，跳过发送消息")
            return False
            
        try:
            safe_message = str(message or "")
            safe_message = safe_message.replace("\\r\\n", "\n").replace("\\n", "\n")

            url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
            data = {
                "chat_id": self.chat_id,
                "text": safe_message,
                "parse_mode": parse_mode
            }
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, data=data)
                response.raise_for_status()
                
            logger.info("Telegram消息发送成功")
            return True
            
        except Exception as e:
            logger.error(f"发送Telegram消息失败: {e}")
            return False
    
    async def send_update_success(self, results: Dict[str, int], duration: float):
        """发送更新成功通知"""
        beijing_tz = _TZ_SHANGHAI
        now_beijing = datetime.now(beijing_tz)
        
        message = f"🎉 *榜单更新成功*\n\n"
        message += f"⏰ 更新时间: {now_beijing.strftime('%Y-%m-%d %H:%M:%S')} (北京时间)\n"
        message += f"⏱️ 耗时: {duration:.1f}秒\n\n"
        message += f"📊 *更新结果:*\n"
        
        for platform, count in results.items():
            message += f"• {platform}: {count}条记录\n"
        
        await self.send_message(message)
    
    async def send_update_error(self, error: str, platform: str = None):
        """发送更新失败通知"""
        beijing_tz = _TZ_SHANGHAI
        now_beijing = datetime.now(beijing_tz)
        
        message = f"❌ *榜单更新失败*\n\n"
        message += f"⏰ 失败时间: {now_beijing.strftime('%Y-%m-%d %H:%M:%S')} (北京时间)\n"
        if platform:
            message += f"🔧 失败平台: {platform}\n"
        message += f"💥 错误信息: {error}\n"
        
        await self.send_message(message)
    
    async def send_scheduler_status(self, status: Dict):
        """发送调度器状态通知"""
        beijing_tz = _TZ_SHANGHAI
        now_beijing = datetime.now(beijing_tz)
        
        message = f"📋 *调度器状态报告*\n\n"
        message += f"⏰ 报告时间: {now_beijing.strftime('%Y-%m-%d %H:%M:%S')} (北京时间)\n"
        message += f"🔄 运行状态: {'✅ 运行中' if status.get('running') else '❌ 已停止'}\n"
        
        if status.get('next_update'):
            next_update = datetime.fromisoformat(status['next_update'].replace('Z', '+00:00'))
            next_update_beijing = next_update.astimezone(beijing_tz)
            message += f"⏰ 下次更新: {next_update_beijing.strftime('%Y-%m-%d %H:%M:%S')} (北京时间)\n"
        
        if status.get('last_update'):
            last_update = datetime.fromisoformat(status['last_update'].replace('Z', '+00:00'))
            last_update_beijing = last_update.astimezone(beijing_tz)
            message += f"🕐 上次更新: {last_update_beijing.strftime('%Y-%m-%d %H:%M:%S')} (北京时间)\n"
        
        await self.send_message(message)

telegram_notifier = TelegramNotifier()

class AutoUpdateScheduler:
    def __init__(self):
        self.running = False
        self.update_interval = 3600
        self.last_update = None
        self.task = None
        
    async def start(self):
        """启动定时任务调度器"""
        if self.running:
            logger.info("调度器已在运行中")
            return
        self.running = True
        logger.info("定时任务调度器已启动")
        
        await telegram_notifier.send_message("🔄 *定时调度器已启动*\n\n⏰ 启动时间: " +
                                           datetime.now(_TZ_SHANGHAI).strftime('%Y-%m-%d %H:%M:%S') + " (北京时间)\n\n📅 每天21:30自动更新所有榜单")
        
        try:
            self.task = asyncio.create_task(self._update_loop())
            logger.info(f"后台任务已创建: {self.task}")
        except Exception as e:
            logger.error(f"创建后台任务失败: {e}")
            self.running = False
            await telegram_notifier.send_update_error(f"调度器启动失败: {str(e)}")
            raise
    
    async def stop(self):
        """停止定时任务调度器"""
        self.running = False
        if self.task:
            self.task.cancel()
            self.task = None
        logger.info("定时任务调度器已停止")
        
        await telegram_notifier.send_message("⏹️ *定时调度器已停止*\n\n⏰ 停止时间: " +
                                           datetime.now(_TZ_SHANGHAI).strftime('%Y-%m-%d %H:%M:%S') + " (北京时间)")
    
    def get_status(self) -> dict:
        """获取调度器状态"""
        from datetime import datetime, timezone, timedelta
        
        beijing_tz = _TZ_SHANGHAI
        now_beijing = datetime.now(beijing_tz)
        today_2130 = now_beijing.replace(hour=21, minute=30, second=0, microsecond=0)
        
        if now_beijing >= today_2130:
            next_update = today_2130 + timedelta(days=1)
        else:
            next_update = today_2130
        
        return {
            'running': self.running,
            'next_update': next_update.isoformat(),
            'last_update': self.last_update.isoformat() if self.last_update else None
        }
    
    def should_update(self) -> bool:
        """检查是否应该执行更新"""
        from datetime import datetime, timezone, timedelta
    
        beijing_tz = _TZ_SHANGHAI
        now_beijing = datetime.now(beijing_tz)
    
        today_2130_start = now_beijing.replace(hour=21, minute=30, second=0, microsecond=0)
        today_2130_end = now_beijing.replace(hour=21, minute=30, second=59, microsecond=999999)
    
        is_after_2130 = now_beijing >= today_2130_start
    
        if is_after_2130:
            if not self.last_update:
                logger.info(f"应该更新：没有上次更新记录，当前时间: {now_beijing.strftime('%Y-%m-%d %H:%M:%S')}")
                return True
        
            if self.last_update.tzinfo:
                last_update_beijing = self.last_update.astimezone(beijing_tz)
            else:
                last_update_beijing = self.last_update.replace(tzinfo=beijing_tz)
        
            last_update_date = last_update_beijing.date()
            today_date = now_beijing.date()
        
            if last_update_date != today_date:
                logger.info(f"应该更新：上次更新({last_update_beijing.strftime('%Y-%m-%d %H:%M:%S')})不是今天，当前时间: {now_beijing.strftime('%Y-%m-%d %H:%M:%S')}")
                return True
            elif not (today_2130_start <= last_update_beijing <= today_2130_end):
                logger.info(f"应该更新：上次更新({last_update_beijing.strftime('%Y-%m-%d %H:%M:%S')})不在今天的21:30这一分钟内，当前时间: {now_beijing.strftime('%Y-%m-%d %H:%M:%S')}")
                return True
            else:
                logger.debug(f"不需要更新：上次更新({last_update_beijing.strftime('%Y-%m-%d %H:%M:%S')})已在今天的21:30这一分钟内，当前时间: {now_beijing.strftime('%Y-%m-%d %H:%M:%S')}")
    
        return False
    
    async def update_all_charts(self):
        """更新所有榜单数据"""
        start_time = time.time()
        logger.info("开始执行定时更新任务...")
        
        await telegram_notifier.send_message("🚀 *开始执行定时更新任务*\n\n⏰ 开始时间: " +
                                           datetime.now(_TZ_SHANGHAI).strftime('%Y-%m-%d %H:%M:%S') + " (北京时间)")
        
        db = SessionLocal()
        results = {}
        error_occurred = False
        
        try:
            scraper = ChartScraper(db)
            
            update_tasks = [
                ("Rotten Tomatoes 本周热门流媒体电影", scraper.update_rotten_movies),
                ("Rotten Tomatoes 本周热门剧集 ", scraper.update_rotten_tv),
                ("Letterboxd 本周热门影视", scraper.update_letterboxd_popular),
                ("Metacritic 本周趋势电影", scraper.update_metacritic_movies),
                ("Metacritic 本周趋势剧集", scraper.update_metacritic_shows),
                ("TMDB 本周趋势影视", scraper.update_tmdb_trending_all_week),
                ("Trakt 上周电影 Top 榜", scraper.update_trakt_movies_weekly),
                ("Trakt 上周剧集 Top 榜", scraper.update_trakt_shows_weekly),
                ("IMDb 本周 Top 10", scraper.update_imdb_top10),
                ("豆瓣 一周口碑榜", scraper.update_douban_weekly_movie),
                ("豆瓣 一周华语剧集口碑榜", scraper.update_douban_weekly_chinese_tv),
                ("豆瓣 一周全球剧集口碑榜", scraper.update_douban_weekly_global_tv)
            ]
            
            for platform_name, update_func in update_tasks:
                try:
                    logger.info(f"开始更新 {platform_name}...")
                    count = await update_func()
                    results[platform_name] = count
                    logger.info(f"{platform_name} 更新完成，获得 {count} 条记录")
                except Exception as e:
                    logger.error(f"{platform_name} 更新失败: {e}")
                    results[platform_name] = 0
                    error_occurred = True
                    await telegram_notifier.send_update_error(str(e), platform_name)
            
            beijing_tz = _TZ_SHANGHAI
            now_beijing = datetime.now(beijing_tz)
            today_2130 = now_beijing.replace(hour=21, minute=30, second=0, microsecond=0)
            self.last_update = today_2130
            today_2130_naive = today_2130.replace(tzinfo=None)
            logger.info(f"更新完成，将上次更新设置为今天的21:30: {today_2130.strftime('%Y-%m-%d %H:%M:%S')} (北京时间)")
            
            duration = time.time() - start_time
            
            try:
                from models import SchedulerStatus
                db_status = db.query(SchedulerStatus).order_by(SchedulerStatus.updated_at.desc()).first()
                if db_status:
                    db_status.last_update = today_2130_naive
                    db.commit()
                    logger.info("数据库中的上次更新已更新")
            except Exception as db_error:
                logger.error(f"更新数据库上次更新失败: {db_error}")
            
            if error_occurred:
                logger.warning("定时更新任务完成，但部分平台更新失败")
                await telegram_notifier.send_message(f"⚠️ *定时更新任务完成*\n\n⏱️ 耗时: {duration:.1f}秒\n\n部分平台更新失败，请查看详细日志")
            else:
                logger.info("定时更新任务完成")
                await telegram_notifier.send_update_success(results, duration)
                
        except Exception as e:
            duration = time.time() - start_time
            logger.error(f"定时更新任务失败: {e}")
            await telegram_notifier.send_update_error(str(e))
        finally:
            db.close()

    async def _update_loop(self):
        """更新循环"""
        logger.info("更新循环已启动，每10秒检查一次是否到了21:30")
        while self.running:
            try:
                from datetime import datetime, timezone, timedelta
                beijing_tz = _TZ_SHANGHAI
                now_beijing = datetime.now(beijing_tz)
                
                if now_beijing.hour == 21 and now_beijing.minute == 30:
                    logger.info(f"更新循环检查中，当前时间: {now_beijing.strftime('%Y-%m-%d %H:%M:%S')} (北京时间)")
                else:
                    logger.debug(f"更新循环检查中，当前时间: {now_beijing.strftime('%Y-%m-%d %H:%M:%S')} (北京时间)")
                
                if self.should_update():
                    logger.info("检测到需要更新，开始执行更新任务...")
                    await self.update_all_charts()
                else:
                    if now_beijing.hour == 21 and now_beijing.minute == 30:
                        logger.debug("当前在21:30这一分钟内，但不需要更新（可能已更新）")
                
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                logger.info("更新循环被取消")
                break
            except Exception as e:
                logger.error(f"更新循环出错: {e}")
                import traceback
                logger.error(f"详细错误: {traceback.format_exc()}")
                await asyncio.sleep(10)

scheduler_instance: Optional[AutoUpdateScheduler] = None

async def start_auto_scheduler(db_session=None):
    """启动全局调度器"""
    global scheduler_instance
    
    logger.info(f"启动调度器 - 当前scheduler_instance: {scheduler_instance}")
    
    if not scheduler_instance:
        scheduler_instance = AutoUpdateScheduler()
        logger.info("创建新的调度器实例")
        
        if db_session:
            try:
                from models import SchedulerStatus
                existing_status = db_session.query(SchedulerStatus).order_by(SchedulerStatus.updated_at.desc()).first()
                if existing_status and existing_status.last_update:
                    scheduler_instance.last_update = existing_status.last_update
                    logger.info(f"从数据库恢复last_update: {existing_status.last_update}")
            except Exception as e:
                logger.warning(f"从数据库恢复last_update失败: {e}")
    
    if not scheduler_instance.running:
        await scheduler_instance.start()
        logger.info(f"调度器启动完成，状态: {scheduler_instance.get_status()}")
    else:
        logger.info("调度器已在运行中")
    
    logger.info(f"返回调度器实例: {scheduler_instance}")
    return scheduler_instance

async def stop_auto_scheduler():
    """停止全局调度器"""
    global scheduler_instance
    if scheduler_instance:
        await scheduler_instance.stop()

def get_scheduler_status() -> dict:
    """获取调度器状态"""
    global scheduler_instance
    
    logger.info(f"获取调度器状态 - scheduler_instance: {scheduler_instance}")
    logger.info(f"scheduler_instance.running: {scheduler_instance.running if scheduler_instance else 'None'}")
    
    if scheduler_instance and scheduler_instance.running:
        status = scheduler_instance.get_status()
        logger.info(f"返回调度器状态: {status}")
        return status
    else:
        from datetime import datetime, timezone, timedelta
        
        beijing_tz = _TZ_SHANGHAI
        now_beijing = datetime.now(beijing_tz)
        today_2130 = now_beijing.replace(hour=21, minute=30, second=0, microsecond=0)
        
        if now_beijing >= today_2130:
            next_update = today_2130 + timedelta(days=1)
        else:
            next_update = today_2130
        
        status = {
            'running': False,
            'next_update': next_update.isoformat(),
            'last_update': None
        }
        logger.info(f"返回默认状态: {status}")
        return status
        
