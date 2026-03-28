// ==========================================
// 榜单列表页
// ==========================================
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { MiniFavoriteButton } from '../modules/favorite/MiniFavoriteButton';
import { exportToPng } from '../modules/export/export';
import { RectangleHorizontal, RectangleVertical, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import { ExportChartCard } from '../modules/export/ExportChartCard';
import { useAggressiveImagePreload } from '../shared/hooks/useAggressiveImagePreload';
import { PageShell } from '../modules/layout/PageShell';
import { usePageMeta } from '../shared/hooks/usePageMeta';
import { posterPathToSiteUrl } from '../api/image';

const DOWNSCALE_SIZE = 'w500';

const resolvePosterUrl = (poster: string) => posterPathToSiteUrl(poster, DOWNSCALE_SIZE);

// 榜单顺序
const CHART_ORDER = ['豆瓣', 'IMDb', 'Rotten Tomatoes', 'Metacritic', 'Letterboxd', 'TMDB', 'Trakt'];

// 各平台的榜单顺序配置
const PLATFORM_CHART_ORDER: Record<string, string[]> = {
  '豆瓣': [
    '一周口碑榜',
    '一周华语剧集口碑榜',
    '一周全球剧集口碑榜',
    '豆瓣2025评分最高华语电影',
    '豆瓣2025评分最高外语电影',
    '豆瓣2025冷门佳片',
    '豆瓣2025评分最高日本电影',
    '豆瓣2025评分最高韩国电影',
    '豆瓣2025评分最高喜剧片',
    '豆瓣2025评分最高爱情片',
    '豆瓣2025评分最高恐怖片',
    '豆瓣2025评分最高动画片',
    '豆瓣2025评分最高纪录片',
    '豆瓣2026最值得期待华语电影',
    '豆瓣2026最值得期待外语电影',
    '豆瓣2025评分最高华语剧集',
    '豆瓣2025评分最高英美新剧',
    '豆瓣2025评分最高英美续订剧',
    '豆瓣2025评分最高日本剧集',
    '豆瓣2025评分最高韩国剧集',
    '豆瓣2025评分最受关注综艺', 
    '豆瓣2025评分最高动画剧集',
    '豆瓣2025评分最高大陆微短剧',
    '豆瓣2025评分最高纪录剧集',
    '豆瓣2026最值得期待剧集',
    '豆瓣2025评分月度热搜影视',
    '豆瓣 电影 Top 250',
  ],
  'IMDb': [
    'IMDb 本周 Top 10',
    'IMDb 2025最受欢迎电影',
    'IMDb 2025最受欢迎剧集',
    'IMDb 工作人员2025最喜爱的电影',
    'IMDb 工作人员2025最喜爱的剧集',
    'IMDb 电影 Top 250',
    'IMDb 剧集 Top 250',
  ],
  'Rotten Tomatoes': [
    '热门流媒体电影',
    '热门剧集',
    'Rotten Tomatoes 2025 最佳电影',
    'Rotten Tomatoes 2025 最佳剧集',
  ],
  'Metacritic': [
    '本周趋势电影',
    '本周趋势剧集',
    'Metacritic 2025 最佳电影',
    'Metacritic 2025 最佳剧集',
    'Metacritic 史上最佳电影 Top 250',
    'Metacritic 史上最佳剧集 Top 250',
  ],
  'Letterboxd': [
    '本周热门影视',
    'Letterboxd 2025 Top 50',
    'Letterboxd 电影 Top 250',
  ],
  'TMDB': [
    '本周趋势影视',
    'TMDB 高分电影 Top 250',
    'TMDB 高分剧集 Top 250',
  ],
  'Trakt': [
    '上周电影 Top 榜',
    '上周剧集 Top 榜',
  ],
};

// 平台名称映射（后端返回的名称 → 前端显示的名称）
const PLATFORM_NAME_MAP: Record<string, string> = {
  '烂番茄': 'Rotten Tomatoes',
  'MTC': 'Metacritic',
};

// 榜单名称映射（后端返回的名称 → 前端显示的名称）
const CHART_NAME_MAP: Record<string, string> = {
  // 豆瓣
  '豆瓣 Top 250': '豆瓣 电影 Top 250',
  // IMDb
  'Top 10 on IMDb this week': 'IMDb 本周 Top 10',
  'IMDb Top 250 Movies': 'IMDb 电影 Top 250',
  'IMDb Top 250 TV Shows': 'IMDb 剧集 Top 250',
  // Rotten Tomatoes
  'Popular Streaming Movies': '热门流媒体电影',
  'Popular TV': '热门剧集',
  // Metacritic
  'Trending Movies This Week': '本周趋势电影',
  'Trending Shows This Week': '本周趋势剧集',
  'Metacritic Best Movies of All Time': 'Metacritic 史上最佳电影 Top 250',
  'Metacritic Best TV Shows of All Time': 'Metacritic 史上最佳剧集 Top 250',
  // Letterboxd
  'Popular films this week': '本周热门影视',
  'Letterboxd Official Top 250': 'Letterboxd 电影 Top 250',
  // TMDB
  '趋势本周': '本周趋势影视',
  'TMDB Top 250 Movies': 'TMDB 高分电影 Top 250',
  'TMDB Top 250 TV Shows': 'TMDB 高分剧集 Top 250',
  // Trakt
  'Top TV Shows Last Week': '上周剧集 Top 榜',
  'Top Movies Last Week': '上周电影 Top 榜',
};

// 不可导出的榜单列表
const NON_EXPORTABLE_CHARTS = [
  '豆瓣2025评分月度热搜影视',
  '豆瓣 电影 Top 250',
  'IMDb 工作人员2025最喜爱的电影',
  'IMDb 工作人员2025最喜爱的剧集',
  'IMDb 电影 Top 250',
  'IMDb 剧集 Top 250',
  'Letterboxd 2025 Top 50',
  'Letterboxd 电影 Top 250',
  'Metacritic 史上最佳电影 Top 250',
  'Metacritic 史上最佳剧集 Top 250',
  'TMDB 高分电影 Top 250',
  'TMDB 高分剧集 Top 250',
  'Rotten Tomatoes 2025 最佳电影',
  'Rotten Tomatoes 2025 最佳剧集',
  'Metacritic 2025 最佳电影',
  'Metacritic 2025 最佳剧集',
];

const PLATFORM_LOGOS: Record<string, string> = {
  '豆瓣': '/logos/douban.png',
  'IMDb': '/logos/imdb.png',
  '烂番茄': '/logos/rottentomatoes.png',
  'Rotten Tomatoes': '/logos/rottentomatoes.png',
  'MTC': '/logos/metacritic.png',
  'Metacritic': '/logos/metacritic.png',
  'Letterboxd': '/logos/letterboxd.png',
  'TMDB': '/logos/tmdb.png',
  'Trakt': '/logos/trakt.png',
};

interface ChartEntry {
  tmdb_id: number;
  rank: number;
  title: string;
  poster: string;
  media_type?: 'movie' | 'tv';
}

interface ChartSection {
  platform: string;
  chart_name: string;
  media_type: 'movie' | 'tv' | 'both';
  entries: ChartEntry[];
}

export default function ChartsPage() {
  usePageMeta({
    title: '榜单 - RateFuse',
    description: '浏览来自豆瓣、IMDb、烂番茄、Metacritic、Letterboxd、TMDB、Trakt 等平台的热门榜单与 Top 列表。',
    canonicalPath: '/charts',
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const contentRef = useRef<HTMLDivElement>(null);

  const isSafariMobile = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent;
    const isMobile = /iPhone|iPad|iPod/.test(ua) || 
                    (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform));
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua) || 
                     (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream);
    return isMobile && isSafari;
  }, []);

  const isCoarsePointer = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  }, []);

  const { data: chartsData, isLoading } = useQuery({
    queryKey: ['public-charts'],
    queryFn: async () => {
      const response = await fetch('/api/charts/public');
      if (!response.ok) {
        throw new Error('获取榜单数据失败');
      }
      const data = await response.json() as ChartSection[];
      return data.map(chart => ({
        ...chart,
        platform: PLATFORM_NAME_MAP[chart.platform] || chart.platform,
        chart_name: CHART_NAME_MAP[chart.chart_name] || chart.chart_name,
      }));
    },
    placeholderData: (previousData) => previousData,
  });

  useAggressiveImagePreload(contentRef, false);

  const sortedCharts = useMemo(() => {
    if (!chartsData) return [];
    return CHART_ORDER.flatMap(platform => 
      chartsData.filter(chart => chart.platform === platform)
    ).concat(
      chartsData.filter(chart => !CHART_ORDER.includes(chart.platform))
    );
  }, [chartsData]);

  const chartsByPlatform = useMemo(() => {
    const result = sortedCharts.reduce((acc, chart) => {
    const platformKey = chart.platform;
    
    const shouldMerge = chart.platform === 'TMDB' || 
                       chart.platform === 'IMDb' || 
                       chart.chart_name === '豆瓣2025评分月度热搜影视';
    
    if (shouldMerge) {
      if (acc[platformKey] && acc[platformKey].length > 0) {
        const existingChart = acc[platformKey].find(c => c.chart_name === chart.chart_name);
        if (existingChart) {
          const existingIds = new Set(existingChart.entries.map(e => `${e.tmdb_id}-${e.rank}`));
          chart.entries.forEach(entry => {
            const entryKey = `${entry.tmdb_id}-${entry.rank}`;
            if (!existingIds.has(entryKey)) {
              existingChart.entries.push(entry);
              existingIds.add(entryKey);
            }
          });
          existingChart.entries.sort((a, b) => a.rank - b.rank);
          existingChart.media_type = 'both';
          return acc;
        }
      }
      const mergedChart = { ...chart, media_type: 'both' as const };
      if (!acc[platformKey]) {
        acc[platformKey] = [];
      }
      acc[platformKey].push(mergedChart);
      return acc;
    }
    
    if (!acc[platformKey]) {
      acc[platformKey] = [];
    }
      acc[platformKey].push(chart);
      return acc;
    }, {} as Record<string, ChartSection[]>);

    Object.keys(result).forEach(platform => {
      if (result[platform]) {
        const platformOrder = PLATFORM_CHART_ORDER[platform];
        
        if (platformOrder) {
          result[platform].sort((a, b) => {
            const indexA = platformOrder.indexOf(a.chart_name);
            const indexB = platformOrder.indexOf(b.chart_name);
            
            if (indexA !== -1 && indexB !== -1) {
              return indexA - indexB;
            }
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return a.chart_name.localeCompare(b.chart_name);
          });
        } else {
          result[platform].sort((a, b) => a.chart_name.localeCompare(b.chart_name));
        }
      }
    });

    return result;
  }, [sortedCharts]);
 
  const platformsWithCharts = useMemo(() => {
    const available = Object.keys(chartsByPlatform || {});
    const ordered = CHART_ORDER.filter((p) => available.includes(p));
    const others = available.filter((p) => !CHART_ORDER.includes(p));
    return [...ordered, ...others];
  }, [chartsByPlatform]);

  const [activePlatform, setActivePlatform] = useState<string | null>(null);

  useEffect(() => {
    if (!platformsWithCharts.length) return;
    const platformFromQuery = searchParams.get('platform');
    setActivePlatform((prev) => {
      if (platformFromQuery && platformsWithCharts.includes(platformFromQuery)) {
        return platformFromQuery;
      }
      return prev && platformsWithCharts.includes(prev) ? prev : platformsWithCharts[0];
    });
  }, [platformsWithCharts, searchParams]);

  const handlePlatformChange = useCallback((platform: string) => {
    setActivePlatform(platform);
    setSearchParams({ platform }, { replace: true });
  }, [setSearchParams]);

  const [exportingChart, setExportingChart] = useState<string | null>(null);
  const desktopStripRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [desktopArrowState, setDesktopArrowState] = useState<
    Record<string, { show: boolean; left: boolean; right: boolean }>
  >({});
  const [activeExportChart, setActiveExportChart] = useState<{
    platform: string;
    chartName: string;
    chartKey: string;
    layout: 'portrait' | 'landscape';
  } | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const posterBase64CacheRef = useRef<Map<string, string>>(new Map());

  const updateDesktopArrows = useCallback((chartKey: string) => {
    const el = desktopStripRefs.current[chartKey];
    if (!el) return;
    const scrollWidth = el.scrollWidth;
    const clientWidth = el.clientWidth;
    const sl = Math.max(0, el.scrollLeft);
    const maxScroll = Math.max(0, scrollWidth - clientWidth);
    const hasOverflow = scrollWidth > clientWidth + 1;
    const nextState = hasOverflow
      ? { show: true, left: sl > 10, right: sl < maxScroll - 10 }
      : { show: false, left: false, right: false };
    setDesktopArrowState((prev) => {
      const current = prev[chartKey];
      if (
        current &&
        current.show === nextState.show &&
        current.left === nextState.left &&
        current.right === nextState.right
      ) {
        return prev;
      }
      return { ...prev, [chartKey]: nextState };
    });
  }, []);

  const scrollDesktopByDir = useCallback((chartKey: string, dir: -1 | 1) => {
    const el = desktopStripRefs.current[chartKey];
    if (!el) return;
    const card = el.querySelector('[data-chart-card]') as HTMLElement | null;
    const step = (card?.offsetWidth ?? 120) + 12;
    el.scrollBy({ left: dir * step * 4, behavior: 'smooth' });
    requestAnimationFrame(() => updateDesktopArrows(chartKey));
  }, [updateDesktopArrows]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const keys = Object.keys(desktopStripRefs.current);
    keys.forEach((chartKey) => {
      const el = desktopStripRefs.current[chartKey];
      if (!el) return;
      const onScroll = () => updateDesktopArrows(chartKey);
      el.addEventListener('scroll', onScroll, { passive: true });
      const ro = new ResizeObserver(() => updateDesktopArrows(chartKey));
      ro.observe(el);
      const first = el.firstElementChild as HTMLElement | null;
      if (first) ro.observe(first);
      updateDesktopArrows(chartKey);
      cleanups.push(() => {
        el.removeEventListener('scroll', onScroll);
        ro.disconnect();
      });
    });
    const onResize = () => keys.forEach((k) => updateDesktopArrows(k));
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cleanups.forEach((fn) => fn());
    };
  }, [sortedCharts, activePlatform, updateDesktopArrows]);

  const handleExportChart = useCallback(async (platform: string, chartName: string, chartKey: string, layout: 'portrait' | 'landscape' = 'portrait') => {
    const exportKey = `${chartKey}-${layout}`;
    if (exportingChart === exportKey) return;

    setExportingChart(exportKey);
    
    setActiveExportChart({ platform, chartName, chartKey, layout });

    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => resolve(null), 100);
        });
      });
    });
    
    try {
      const element = exportRef.current;
      if (!element) {
        console.error('导出元素未找到');
        return;
      }

      const chart = sortedCharts?.find(c => 
        c.platform === platform && c.chart_name === chartName
      );
      
        if (chart && element) {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                        (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform));

        const maxConcurrent = isMobile ? 4 : 10;
        const timeout = isMobile ? 2000 : 3000;
        const maxEntriesToConvert = 24;
        const prepDeadline = Date.now() + 20000;

        const { getBase64Image } = await import('../api/image');

        const entriesToConvert = chart.entries
          .sort((a, b) => a.rank - b.rank)
          .filter(entry => entry.poster && entry.poster.trim() !== '')
          .slice(0, maxEntriesToConvert);

        for (let i = 0; i < entriesToConvert.length; i += maxConcurrent) {
          if (Date.now() >= prepDeadline) break;
          const batch = entriesToConvert.slice(i, i + maxConcurrent);

          const batchPromises = batch.map(async (entry) => {
            try {
              const cachedBase64 = posterBase64CacheRef.current.get(entry.poster!);
              const base64 = cachedBase64 || await getBase64Image(entry.poster!);
              if (!cachedBase64) {
                posterBase64CacheRef.current.set(entry.poster!, base64);
              }
              if (Date.now() >= prepDeadline) return;
              const images = element.getElementsByTagName('img');
              for (let j = 0; j < images.length; j++) {
                const img = images[j];
                if (img.getAttribute('alt') === entry.title) {
                  img.src = base64;
                  await new Promise<void>((resolve) => {
                    if (img.complete && img.naturalWidth > 0) resolve();
                    else {
                      img.onload = () => resolve();
                      img.onerror = () => resolve();
                      setTimeout(() => resolve(), timeout);
                    }
                  });
                  break;
                }
              }
            } catch (error) {
              console.warn(`海报转换失败 (${entry.title}):`, error);
            }
          });

          await Promise.all(batchPromises);
          if (isMobile && i + maxConcurrent < entriesToConvert.length) {
            await new Promise(r => requestAnimationFrame(() => setTimeout(r, 20)));
          }
        }
      }

      await new Promise(resolve => {
        requestAnimationFrame(() => {
          setTimeout(() => resolve(null), 0);
        });
      });

      const images = element.getElementsByTagName('img');
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                      (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform));
      const timeout = isMobile ? 3000 : 5000;
      
      const imagePromises = Array.from(images).map(img => {
        if (img.complete && img.naturalWidth > 0) {
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
          setTimeout(() => resolve(), timeout);
        });
      });
      
      await Promise.all(imagePromises);
      await new Promise(resolve => setTimeout(resolve, isMobile ? 100 : 200));

      const fileName = `${platform}-${chartName}`.replace(/[/\\?%*:|"<>]/g, '-');
      const cacheKey = `chart-${platform}-${chartName}-${layout}`;
      await exportToPng(element, `${fileName}.png`, { isChart: true, cacheKey });
    } catch (error) {
      console.error('导出失败:', error);
    } finally {
      setExportingChart(null);
      setActiveExportChart(null);
    }
  }, [sortedCharts, exportingChart]);

  return (
    <PageShell maxWidth="7xl" contentClassName="py-2 sm:py-3">
      <div ref={contentRef} className="gentle-scroll">
        <div className="space-y-8">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-gray-600 dark:text-gray-400">加载中...</div>
            </div>
          ) : sortedCharts.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-600 dark:text-gray-400">
                暂无榜单数据
              </div>
            </div>
          ) : platformsWithCharts.length === 0 || !activePlatform ? (
            <div className="text-center py-12">
              <div className="text-gray-600 dark:text-gray-400">
                暂无可用平台数据
              </div>
            </div>
          ) : (
            <div className="glass-card no-lift rounded-2xl overflow-hidden">
              <div className="px-3 sm:px-6 pt-3 sm:pt-4 pb-2">
                {/* 平台选择区 */}
                <div className="grid w-full max-w-[min(100%,28rem)] mx-auto grid-cols-7 gap-1.5 sm:gap-3 justify-items-center">
                  {CHART_ORDER.map((platform) => {
                    const isActive = platform === activePlatform;
                    const isAvailable = platformsWithCharts.includes(platform);
                    return (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => {
                          if (!isAvailable || isActive) return;
                          handlePlatformChange(platform);
                        }}
                        aria-pressed={isActive}
                        disabled={!isAvailable}
                        className={[
                          'aspect-square w-full max-w-11 min-w-0 rounded-xl backdrop-blur-md flex items-center justify-center border no-hover-scale',
                          isActive
                            ? 'bg-blue-500/20 dark:bg-blue-500/15 border-blue-500/60 dark:border-blue-400/40 opacity-100'
                            : isAvailable
                              ? 'bg-white/80 dark:bg-white/10 border-transparent opacity-60 hover:opacity-80'
                              : 'bg-white/40 dark:bg-white/5 border-transparent opacity-30',
                        ].join(' ')}
                        title={platform}
                      >
                        {PLATFORM_LOGOS[platform] ? (
                          <img
                            src={PLATFORM_LOGOS[platform]}
                            alt={platform}
                            className="w-4 h-4 sm:w-6 sm:h-6 object-contain max-w-full max-h-full"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                            {platform.slice(0, 2)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="px-3 sm:px-6 pb-4 sm:pb-6 pt-3 sm:pt-4 space-y-5 sm:space-y-6">
                {(chartsByPlatform[activePlatform] || []).map((chart, idx) => {
                        const chartKey = `${chart.platform}-${chart.chart_name}-${idx}`;
                        const sortedEntries = [...chart.entries].sort((a, b) => a.rank - b.rank);
                        
                        const isNonExportable = NON_EXPORTABLE_CHARTS.includes(chart.chart_name);
                        const maxDisplayEntries = isSafariMobile ? 10 : Infinity;
                        const displayEntries = isNonExportable 
                          ? sortedEntries.slice(0, 10) 
                          : sortedEntries.slice(0, maxDisplayEntries);
                        
                  return (
                        <div key={chartKey}>
                          <div className="flex items-center justify-between mb-3 sm:mb-4 gap-3">
                            <h3 className="text-base sm:text-lg font-semibold text-gray-700 dark:text-gray-300">
                              {chart.chart_name}
                            </h3>
                            {isNonExportable ? (
                              <Link
                                to={`/charts/${encodeURIComponent(chart.platform)}/${encodeURIComponent(chart.chart_name)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-11 h-11 rounded-full glass-button flex items-center justify-center text-gray-800 dark:text-white hover:scale-105 active:scale-95 transition-all"
                                aria-label="打开详情"
                              >
                                <MoreHorizontal className="w-5 h-5" />
                              </Link>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleExportChart(chart.platform, chart.chart_name, chartKey, 'portrait')}
                                  disabled={exportingChart === `${chartKey}-portrait` || exportingChart === `${chartKey}-landscape`}
                                  className="w-11 h-11 rounded-full glass-button flex items-center justify-center text-gray-800 dark:text-white hover:scale-105 active:scale-95 transition-all disabled:opacity-60"
                                  title="竖版导出"
                                  aria-label="竖版导出"
                                >
                                  {exportingChart === `${chartKey}-portrait` ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
                                  ) : (
                                    <RectangleVertical className="w-5 h-5" />
                                  )}
                                </button>
                                <button
                                  onClick={() => handleExportChart(chart.platform, chart.chart_name, chartKey, 'landscape')}
                                  disabled={exportingChart === `${chartKey}-portrait` || exportingChart === `${chartKey}-landscape`}
                                  className="w-11 h-11 rounded-full glass-button flex items-center justify-center text-gray-800 dark:text-white hover:scale-105 active:scale-95 transition-all disabled:opacity-60"
                                  title="横版导出"
                                  aria-label="横版导出"
                                >
                                  {exportingChart === `${chartKey}-landscape` ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
                                  ) : (
                                    <RectangleHorizontal className="w-5 h-5" />
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                          {chart.entries.length === 0 ? (
                            <div className="text-gray-500 dark:text-gray-400 text-sm">
                              暂无数据
                            </div>
                          ) : (
                            <>
                              {/* 移动端横滑 */}
                              <div
                                className={`${isCoarsePointer ? 'flex sm:hidden' : 'hidden'} gap-2 overflow-x-auto overscroll-x-contain snap-x snap-mandatory pb-1 scrollbar-hide`}
                                style={{
                                  contain: 'layout style',
                                  WebkitOverflowScrolling: 'touch',
                                }}
                              >
                                {displayEntries.map((entry, idx) => {
                                    const mediaType = entry.media_type || 
                                      (chart.media_type === 'both' ? 'movie' : chart.media_type);
                                    const linkPath = mediaType === 'movie' 
                                      ? `/movie/${entry.tmdb_id}` 
                                      : `/tv/${entry.tmdb_id}`;
                                    
                                    const shouldUseEager = !isSafariMobile && idx < 20;
                                    const fetchPriorityValue = isSafariMobile 
                                      ? (idx < 5 ? 'high' : 'low')
                                      : (idx < 20 ? 'high' : idx < 60 ? 'auto' : 'low');
                                    
                                    return (
<div
                                            key={`${entry.tmdb_id}-${entry.rank}`}
                                            className="group relative shrink-0 snap-start w-[31vw] min-w-[104px] max-w-[146px]"
                                            style={{ contain: 'layout style' }}
                                          >
                                        <Link to={linkPath} className="block">
                                          <div
                                            className="aspect-[2/3] rounded-lg overflow-hidden relative bg-gray-200 dark:bg-gray-800 transition-all duration-200 group-hover:shadow-lg"
                                            style={{ transform: 'translateZ(0)' }}
                                          >
                                            {entry.poster ? (
                                              <img
                                                src={resolvePosterUrl(entry.poster)}
                                                alt={entry.title}
                                                className="w-full h-full object-cover transition-all duration-200 group-hover:scale-105"
                                                loading={shouldUseEager ? 'eager' : 'lazy'}
                                                fetchPriority={fetchPriorityValue}
                                                decoding="async"
                                                sizes="(min-width:1280px) 10vw, (min-width:1024px) 14vw, (min-width:640px) 20vw, 33vw"
                                                style={{
                                                  minHeight: '100%',
                                                  display: 'block',
                                                  opacity: 0,
                                                  transition: 'opacity 0.2s ease-in',
                                                }}
                                                onLoad={(e) => {
                                                  const target = e.target as HTMLImageElement;
                                                  if (target && target.complete && target.naturalWidth > 0) {
                                                    requestAnimationFrame(() => {
                                                      target.style.opacity = '1';
                                                    });
                                                  }
                                                }}
                                                onError={(e) => {
                                                  const target = e.target as HTMLImageElement;
                                                  if (target) {
                                                    target.style.opacity = '0';
                                                  }
                                                }}
                                              />
                                            ) : (
                                              <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-800">
                                                <div className="text-gray-400 dark:text-gray-600 text-xs">无海报</div>
                                              </div>
                                            )}
                                            {/* 排名数字 */}
                                            <span
                                              className={`absolute top-0 left-0 pointer-events-none z-10 font-extrabold leading-none whitespace-nowrap ${entry.rank === 1 ? 'chart-rank-num-1' : 'chart-rank-num-other'}`}
                                              style={{
                                                background: 'linear-gradient(to bottom, #fff 50%,rgb(78, 76, 76) 100%)',
                                                WebkitBackgroundClip: 'text',
                                                color: 'transparent',
                                                filter: 'drop-shadow(2px 0px 8.1px rgba(0,0,0,0.5))',
                                              }}
                                            >
                                              {chart.chart_name === '豆瓣2025评分月度热搜影视' &&
                                              entry.rank >= 1 &&
                                              entry.rank <= 12
                                                ? `${entry.rank}月`
                                                : entry.rank}
                                            </span>
                                          </div>
                                          <div className="mt-1 text-xs text-center text-gray-700 dark:text-gray-300 line-clamp-2">
                                            {entry.title}
                                          </div>
                                        </Link>
                                        <div className="absolute top-1 right-1 z-20">
                                          <MiniFavoriteButton
                                            mediaId={entry.tmdb_id.toString()}
                                            mediaType={mediaType}
                                            title={entry.title}
                                            poster={entry.poster}
                                            className="p-1"
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                              </div>
                              {/* 平板/桌面端：仅溢出时显示左右箭头 */}
                              <div className={`relative ${isCoarsePointer ? 'hidden sm:block' : 'block'}`}>
                                {desktopArrowState[chartKey]?.show && desktopArrowState[chartKey]?.left ? (
                                  <button
                                    type="button"
                                    aria-label="向左"
                                    onClick={() => scrollDesktopByDir(chartKey, -1)}
                                    className="absolute inset-y-0 left-0 z-30 flex w-10 items-center justify-center rounded-2xl bg-white/40 dark:bg-white/40"
                                  >
                                    <ChevronLeft className="h-5 w-5 text-gray-800 dark:text-gray-100" />
                                  </button>
                                ) : null}
                                {desktopArrowState[chartKey]?.show && desktopArrowState[chartKey]?.right ? (
                                  <button
                                    type="button"
                                    aria-label="向右"
                                    onClick={() => scrollDesktopByDir(chartKey, 1)}
                                    className="absolute inset-y-0 right-0 z-30 flex w-10 items-center justify-center rounded-2xl bg-white/40 dark:bg-white/40"
                                  >
                                    <ChevronRight className="h-5 w-5 text-gray-800 dark:text-gray-100" />
                                  </button>
                                ) : null}
                                <div
                                  ref={(el) => {
                                    desktopStripRefs.current[chartKey] = el;
                                  }}
                                  className="grid grid-flow-col auto-cols-[minmax(96px,calc((100%-6.75rem)/10))] gap-2 sm:gap-3 overflow-x-auto scrollbar-hide pr-8"
                                  style={{ contain: 'layout style' }}
                                >
                                {displayEntries.map((entry, idx) => {
                                    const mediaType = entry.media_type || 
                                      (chart.media_type === 'both' ? 'movie' : chart.media_type);
                                    const linkPath = mediaType === 'movie' 
                                      ? `/movie/${entry.tmdb_id}` 
                                      : `/tv/${entry.tmdb_id}`;
                                    
                                    const shouldUseEager = !isSafariMobile && idx < 20;
                                    const fetchPriorityValue = isSafariMobile 
                                      ? (idx < 5 ? 'high' : 'low')
                                      : (idx < 20 ? 'high' : idx < 60 ? 'auto' : 'low');
                                    
                                    return (
<div
                                            key={`${entry.tmdb_id}-${entry.rank}`}
                                            data-chart-card
                                            className="group relative"
                                            style={{ contain: 'layout style' }}
                                          >
                                        <Link to={linkPath} className="block">
                                          <div
                                            className="aspect-[2/3] rounded-lg overflow-hidden relative bg-gray-200 dark:bg-gray-800 transition-all duration-200 group-hover:shadow-lg"
                                            style={{ transform: 'translateZ(0)' }}
                                          >
                                            {entry.poster ? (
                                              <img
                                                src={resolvePosterUrl(entry.poster)}
                                                alt={entry.title}
                                                className="w-full h-full object-cover transition-all duration-200 group-hover:scale-105"
                                                loading={shouldUseEager ? 'eager' : 'lazy'}
                                                fetchPriority={fetchPriorityValue}
                                                decoding="async"
                                                sizes="(min-width:1280px) 10vw, (min-width:1024px) 14vw, (min-width:640px) 20vw, 33vw"
                                                style={{
                                                  minHeight: '100%',
                                                  display: 'block',
                                                  opacity: 0,
                                                  transition: 'opacity 0.2s ease-in',
                                                }}
                                                onLoad={(e) => {
                                                  const target = e.target as HTMLImageElement;
                                                  if (target && target.complete && target.naturalWidth > 0) {
                                                    requestAnimationFrame(() => {
                                                      target.style.opacity = '1';
                                                    });
                                                  }
                                                }}
                                                onError={(e) => {
                                                  const target = e.target as HTMLImageElement;
                                                  if (target) {
                                                    target.style.opacity = '0';
                                                  }
                                                }}
                                              />
                                            ) : (
                                              <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-800">
                                                <div className="text-gray-400 dark:text-gray-600 text-xs">无海报</div>
                                              </div>
                                            )}
                                            {/* 排名数字 */}
                                            <span
                                              className={`absolute top-0 left-0 pointer-events-none z-10 font-extrabold leading-none whitespace-nowrap ${entry.rank === 1 ? 'chart-rank-num-1' : 'chart-rank-num-other'}`}
                                              style={{
                                                background: 'linear-gradient(to bottom, #fff 50%,rgb(78, 76, 76) 100%)',
                                                WebkitBackgroundClip: 'text',
                                                color: 'transparent',
                                                filter: 'drop-shadow(2px 0px 8.1px rgba(0,0,0,0.5))',
                                              }}
                                            >
                                              {chart.chart_name === '豆瓣2025评分月度热搜影视' &&
                                              entry.rank >= 1 &&
                                              entry.rank <= 12
                                                ? `${entry.rank}月`
                                                : entry.rank}
                                            </span>
                                          </div>
                                          <div className="mt-1 text-xs text-center text-gray-700 dark:text-gray-300 line-clamp-2">
                                            {entry.title}
                                          </div>
                                        </Link>
                                        <div className="absolute top-1 right-1 z-20">
                                          <MiniFavoriteButton
                                            mediaId={entry.tmdb_id.toString()}
                                            mediaType={mediaType}
                                            title={entry.title}
                                            poster={entry.poster}
                                            className="p-1"
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                        );
                      })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 按需渲染的导出容器 */}
      {activeExportChart && (() => {
        const chart = sortedCharts?.find(c => 
          c.platform === activeExportChart.platform && 
          c.chart_name === activeExportChart.chartName
        );
        
        if (!chart) return null;
        
        return (
          <div className="fixed left-0 top-0 -z-50 pointer-events-none opacity-0">
            <div ref={exportRef}>
              <ExportChartCard 
                platform={chart.platform}
                chartName={chart.chart_name}
                entries={chart.entries.sort((a, b) => a.rank - b.rank)}
                platformLogo={PLATFORM_LOGOS[chart.platform]}
                layout={activeExportChart.layout}
              />
            </div>
          </div>
        );
      })()}
    </PageShell>
  );
}
