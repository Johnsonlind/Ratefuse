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
import { getPreferredPosterUrlForMedia } from '../api/preferredPoster';
const DOWNSCALE_SIZE = 'w500';

const CHART_ORDER = ['豆瓣', 'IMDb', 'Rotten Tomatoes', 'Metacritic', 'Letterboxd', 'TMDB', 'Trakt'];

const PLATFORM_LOGOS: Record<string, string> = {
  '豆瓣': '/logos/douban.png',
  'IMDb': '/logos/imdb.png',
  'Rotten Tomatoes': '/logos/rottentomatoes.png',
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
  visible?: boolean;
  sort_order?: number;
  layout?: 'table' | 'card';
  table_rows?: number;
  card_count?: number;
  exportable?: boolean;
  rank_label_mode?: 'number' | 'month';
}

function ChartPosterImage({
  entry,
  mediaType,
  shouldUseEager,
  fetchPriorityValue,
  sizes,
}: {
  entry: ChartEntry;
  mediaType: 'movie' | 'tv';
  shouldUseEager: boolean;
  fetchPriorityValue: 'high' | 'auto' | 'low';
  sizes: string;
}) {
  const { data: preferredPosterUrl, isFetched } = useQuery({
    queryKey: ['chart-preferred-poster', mediaType, entry.tmdb_id, entry.poster, DOWNSCALE_SIZE],
    queryFn: async () =>
      await getPreferredPosterUrlForMedia(mediaType, entry.tmdb_id, entry.poster || '', DOWNSCALE_SIZE, {
        strictPreferred: true,
      }),
    enabled: !!entry.poster,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
  });

  if (preferredPosterUrl) {
    return (
      <img
        src={preferredPosterUrl}
        alt={entry.title}
        className="w-full h-full object-cover transition-all duration-200 group-hover:scale-105"
        loading={shouldUseEager ? 'eager' : 'lazy'}
        fetchPriority={fetchPriorityValue}
        decoding="async"
        sizes={sizes}
        style={{ minHeight: '100%', display: 'block' }}
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          if (target) target.style.opacity = '0';
        }}
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-800">
      <div className="text-gray-400 dark:text-gray-600 text-xs">{entry.poster ? (isFetched ? '无海报' : '加载中...') : '无海报'}</div>
    </div>
  );
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
    const hasMSStream = 'MSStream' in window;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua) || 
                     (/iPad|iPhone|iPod/.test(ua) && !hasMSStream);
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
      return data.filter((chart) => chart.visible !== false);
    },
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
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
      if (!acc[platformKey]) {
        acc[platformKey] = [];
      }
      acc[platformKey].push({ ...chart });
      return acc;
    }, {} as Record<string, ChartSection[]>);

    Object.keys(result).forEach(platform => {
      if (result[platform]) {
        result[platform].sort((a, b) => {
          const sa = a.sort_order ?? Number.MAX_SAFE_INTEGER;
          const sb = b.sort_order ?? Number.MAX_SAFE_INTEGER;
          if (sa !== sb) return sa - sb;
          return a.chart_name.localeCompare(b.chart_name);
        });
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


  const activePlatform = useMemo(() => {
    if (!platformsWithCharts.length) return null;
    const q = searchParams.get('platform');
    if (q && platformsWithCharts.includes(q)) return q;
    return platformsWithCharts[0];
  }, [platformsWithCharts, searchParams]);

  const handlePlatformChange = useCallback(
    (platform: string) => {
      setSearchParams({ platform }, { replace: true });
    },
    [setSearchParams],
  );

  const [exportingChart, setExportingChart] = useState<string | null>(null);
  const formatRankLabel = useCallback((chart: ChartSection, rank: number) => {
    return chart.rank_label_mode === 'month' ? `${rank}月` : String(rank);
  }, []);
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
        const timeout = isMobile ? 3500 : 4000;
        const maxEntriesToConvert = 280;
        const prepDeadline = Date.now() + 90000;

        const { getBase64Image } = await import('../api/image');

        const entriesToConvert = chart.entries
          .sort((a, b) => a.rank - b.rank)
          .filter(entry => entry.poster && entry.poster.trim() !== '')
          .slice(0, maxEntriesToConvert);

        const applyBase64ToPosterImg = async (entry: (typeof entriesToConvert)[0], base64: string) => {
          const key = `${entry.tmdb_id}-${entry.rank}`;
          const img = element.querySelector(`img[data-export-poster-key="${key}"]`) as HTMLImageElement | null;
          if (!img) {
            console.warn(`导出: 未找到海报节点 (${key} ${entry.title})`);
            return;
          }
          const parent = img.parentElement;
          if (parent) {
            parent.querySelectorAll('.placeholder').forEach((el) => el.remove());
          }
          img.style.display = 'block';
          img.removeAttribute('width');
          img.removeAttribute('height');
          img.src = base64;
          await new Promise<void>((resolve) => {
            if (img.complete && img.naturalWidth > 0) resolve();
            else {
              img.onload = () => resolve();
              img.onerror = () => resolve();
              setTimeout(() => resolve(), timeout);
            }
          });
        };

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
              await applyBase64ToPosterImg(entry, base64);
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
                        
                        const isNonExportable = chart.exportable === false;
                        const hasMore = sortedEntries.length > 10;
                        const displayEntries = sortedEntries.slice(0, 10);
                        
                  return (
                        <div key={chartKey}>
                          <div className="flex items-center justify-between mb-3 sm:mb-4 gap-3">
                            <h3 className="text-base sm:text-lg font-semibold text-gray-700 dark:text-gray-300">
                              {chart.chart_name}
                            </h3>
                            {(isNonExportable || hasMore) ? (
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
                                style={{ WebkitOverflowScrolling: 'touch' }}
                              >
                                {displayEntries.map((entry, idx) => {
                                    const mediaType = entry.media_type || 
                                      (chart.media_type === 'both' ? 'movie' : chart.media_type);
                                    const linkPath = mediaType === 'movie' 
                                      ? `/movie/${entry.tmdb_id}` 
                                      : `/tv/${entry.tmdb_id}`;
                                    
                                    const shouldUseEager = idx < 12;
                                    const fetchPriorityValue = isSafariMobile
                                      ? (idx < 8 ? 'high' : idx < 20 ? 'auto' : 'low')
                                      : (idx < 20 ? 'high' : idx < 60 ? 'auto' : 'low');
                                    
                                    return (
<div
                                            key={`${entry.tmdb_id}-${entry.rank}`}
                                            className="group relative shrink-0 snap-start w-[31vw] min-w-[104px] max-w-[146px]"
                                          >
                                        <Link to={linkPath} className="block">
                                          <div
                                            className="aspect-[2/3] rounded-lg overflow-hidden relative bg-gray-200 dark:bg-gray-800 transition-all duration-200 group-hover:shadow-lg"
                                            style={{ transform: 'translateZ(0)' }}
                                          >
                                            <ChartPosterImage
                                              entry={entry}
                                              mediaType={mediaType as 'movie' | 'tv'}
                                              shouldUseEager={shouldUseEager}
                                              fetchPriorityValue={fetchPriorityValue}
                                              sizes="(max-width:639px) 33vw, 120px"
                                            />
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
                                              {formatRankLabel(chart, entry.rank)}
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
                              {/* 平板/桌面端左右箭头 */}
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
                                >
                                {displayEntries.map((entry, idx) => {
                                    const mediaType = entry.media_type || 
                                      (chart.media_type === 'both' ? 'movie' : chart.media_type);
                                    const linkPath = mediaType === 'movie' 
                                      ? `/movie/${entry.tmdb_id}` 
                                      : `/tv/${entry.tmdb_id}`;
                                    
                                    const shouldUseEager = idx < 12;
                                    const fetchPriorityValue = isSafariMobile
                                      ? (idx < 8 ? 'high' : idx < 20 ? 'auto' : 'low')
                                      : (idx < 20 ? 'high' : idx < 60 ? 'auto' : 'low');
                                    
                                    return (
<div
                                            key={`${entry.tmdb_id}-${entry.rank}`}
                                            data-chart-card
                                            className="group relative"
                                          >
                                        <Link to={linkPath} className="block">
                                          <div
                                            className="aspect-[2/3] rounded-lg overflow-hidden relative bg-gray-200 dark:bg-gray-800 transition-all duration-200 group-hover:shadow-lg"
                                            style={{ transform: 'translateZ(0)' }}
                                          >
                                            <ChartPosterImage
                                              entry={entry}
                                              mediaType={mediaType as 'movie' | 'tv'}
                                              shouldUseEager={shouldUseEager}
                                              fetchPriorityValue={fetchPriorityValue}
                                              sizes="(min-width:1280px) 120px, (min-width:640px) 12vw, 96px"
                                            />
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
                                              {formatRankLabel(chart, entry.rank)}
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
