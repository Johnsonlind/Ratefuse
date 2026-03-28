// ==========================================
// 榜单详情页
// ==========================================
import { useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MiniFavoriteButton } from '../modules/favorite/MiniFavoriteButton';
import { ArrowLeft } from 'lucide-react';
import { useAggressiveImagePreload } from '../shared/hooks/useAggressiveImagePreload';
import { PageShell } from '../modules/layout/PageShell';
import { usePageMeta } from '../shared/hooks/usePageMeta';
import { posterPathToSiteUrl } from '../api/image';

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

interface ChartDetail {
  platform: string;
  chart_name: string;
  media_type: 'movie' | 'tv' | 'both';
  entries: ChartEntry[];
}

export default function ChartDetailPage() {
  const { platform, chartName } = useParams<{ platform: string; chartName: string }>();
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);

  const backToCharts = () => {
    const platformParam = platform ? `?platform=${encodeURIComponent(platform)}` : '';
    navigate(`/charts${platformParam}`);
  };

  usePageMeta({
    title: chartName ? `${chartName} - RateFuse` : '榜单详情 - RateFuse',
    description: chartName ? `查看「${chartName}」完整榜单，并一键跳转到条目详情。` : '查看完整榜单，并一键跳转到条目详情。',
    canonicalPath: platform && chartName ? `/charts/${encodeURIComponent(platform)}/${encodeURIComponent(chartName)}` : undefined,
  });

  const { data, isLoading, error } = useQuery<ChartDetail>({
    queryKey: ['chart-detail', platform, chartName],
    queryFn: async () => {
      if (!platform || !chartName) {
        throw new Error('缺少必要参数');
      }
      const response = await fetch(
        `/api/charts/detail?platform=${encodeURIComponent(platform)}&chart_name=${encodeURIComponent(chartName)}`
      );
      if (!response.ok) {
        throw new Error('获取榜单数据失败');
      }
      return response.json();
    },
    enabled: !!platform && !!chartName,
    placeholderData: (previousData) => previousData,
  });

  useAggressiveImagePreload(contentRef, !isLoading && !!data);

  if (isLoading) {
    return (
      <PageShell maxWidth="7xl" contentClassName="flex items-center justify-center py-12">
          <div className="text-gray-600 dark:text-gray-400">加载中...</div>
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell maxWidth="7xl" contentClassName="py-6">
          <div className="flex flex-col items-center justify-center py-12">
            <div className="text-gray-600 dark:text-gray-400 mb-4">
              加载失败，请稍后重试
            </div>
            <button
              onClick={backToCharts}
              className="glass-button px-4 py-2 text-gray-800 dark:text-white"
            >
              返回榜单页
            </button>
          </div>
      </PageShell>
    );
  }

  const sortedEntries = [...data.entries].sort((a, b) => a.rank - b.rank);

  const shouldLimitToTop250 = /top\s*250/i.test(data.chart_name || chartName || '');
  const displayedEntries = shouldLimitToTop250 ? sortedEntries.slice(0, 250) : sortedEntries;

  return (
    <PageShell maxWidth="7xl" contentClassName="py-2 sm:py-3">
      <div ref={contentRef} className="gentle-scroll">
        <div className="space-y-6">
          {/* 返回按钮和标题 */}
          <div className="flex items-center gap-3 sm:gap-4 mb-5 sm:mb-6 pl-1">
            <button
              onClick={backToCharts}
              className="home-top-tone-button w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
              aria-label="返回榜单页"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3">
              {PLATFORM_LOGOS[data.platform] && (
                <img 
                  src={PLATFORM_LOGOS[data.platform]} 
                  alt={data.platform}
                  className="w-8 h-8 object-contain"
                />
              )}
              <div>
                <h1 className="text-2xl font-bold text-gray-800 dark:text-white">
                  {data.chart_name}
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {data.platform} · 共 {displayedEntries.length} 部作品
                </p>
              </div>
            </div>
          </div>

          {/* 榜单内容 */}
          {displayedEntries.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-500 dark:text-gray-400">
                暂无数据
              </div>
            </div>
          ) : (
            <div className="glass-card rounded-2xl p-3 sm:p-6">
              <div className="grid grid-cols-3 min-[420px]:grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2 sm:gap-3" style={{ contain: 'layout style' }}>
                {displayedEntries.map((entry, idx) => {
                  const mediaType = entry.media_type || 
                    (data.media_type === 'both' ? 'movie' : data.media_type);
                  const linkPath = mediaType === 'movie' 
                    ? `/movie/${entry.tmdb_id}` 
                    : `/tv/${entry.tmdb_id}`;
                  
                  return (
                    <div
                      key={`${entry.tmdb_id}-${entry.rank}`}
                      className="group relative"
                      style={{ contain: 'layout style' }}
                    >
                      <Link to={linkPath}>
                        <div
                          className="aspect-[2/3] rounded-lg overflow-hidden relative bg-gray-200 dark:bg-gray-800"
                          style={{ transform: 'translateZ(0)' }}
                        >
                          {entry.poster ? (
                            <img
                              src={posterPathToSiteUrl(entry.poster, 'w500')}
                              alt={entry.title}
                              className="w-full h-full object-cover transition-opacity duration-200 group-hover:scale-105"
                              loading={idx < 10 ? 'eager' : 'lazy'}
                              fetchPriority={idx < 10 ? 'high' : idx < 40 ? 'auto' : 'low'}
                              style={{
                                willChange: 'transform',
                                minHeight: '100%',
                                display: 'block',
                                opacity: 0,
                                transition: 'opacity 0.2s ease-in, transform 0.2s ease-out',
                              }}
                              decoding="async"
                              sizes="(min-width:1280px) 10vw, (min-width:1024px) 14vw, (min-width:640px) 20vw, 33vw"
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
                            className={`absolute top-1 left-1.5 pointer-events-none z-10 font-extrabold leading-none whitespace-nowrap ${entry.rank === 1 ? 'chart-rank-num-1' : 'chart-rank-num-other'}`}
                            style={{
                              background: 'linear-gradient(to bottom, #fff 50%,rgb(78, 76, 76) 100%)',
                              WebkitBackgroundClip: 'text',
                              color: 'transparent',
                              filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.95)) drop-shadow(0 0 4px rgba(0,0,0,0.85)) drop-shadow(2px 0px 8.1px rgba(0,0,0,0.5))',
                            }}
                          >
                            {chartName === '豆瓣2025评分月度热搜影视' && entry.rank >= 1 && entry.rank <= 12
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
          )}
        </div>
      </div>
    </PageShell>
  );
}
