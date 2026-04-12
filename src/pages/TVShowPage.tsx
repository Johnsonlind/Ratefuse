// ==========================================
// 剧集详情页
// ==========================================
import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { TVShowHero } from '../modules/media/TVShowHero';
import { Credits } from '../modules/media/Credits';
import { getTVShow } from '../api/tv';
import { messages } from '../shared/utils/messages';
import { exportToPng } from '../modules/export/export';
import { ExportTVShowRatingCard } from '../modules/export/ExportTVShowRatingCard';
import { TVShowMetadata } from '../modules/media/TVShowMetadata';
import { preloadImages } from '../modules/export/export';
import type { FetchStatus, BackendPlatformStatus } from '../shared/types/status';
import { getBase64ImageWithOptions } from '../api/image';
import { TVShowRatingData } from '../modules/rating/ratings';
import { ExportButton, type ExportLayout } from '../modules/export/ExportButton';
import { FavoriteButton } from '../modules/favorite/FavoriteButton';
import { ErrorMessage } from '../shared/ui/ErrorMessage';
import { useMediaRatings } from '../modules/rating/useMediaRatings';
import { MediaPageSkeleton } from '../modules/media/MediaPageSkeleton';
import { PlatformStatusBar } from '../modules/rating/PlatformStatusBar';
import { TVShowRatingGrid } from '../modules/rating/TVShowRatingGrid';
import { OverallRatingCard } from '../modules/rating/OverallRatingCard';
import { calculateOverallRating } from '../modules/rating/calculateOverallRating';
import { SeasonRatings } from '../modules/rating/SeasonRatings';
import type { TVShow } from '../shared/types/media';
import { PageShell } from '../modules/layout/PageShell';
import { usePageMeta } from '../shared/hooks/usePageMeta';
import { useDetailViewTracking } from '../shared/hooks/useDetailViewTracking';
import { ResourceSection } from '../modules/resources/ResourceSection';

const PRELOAD_IMAGES = [
  `/logos/douban.png`,
  `/logos/imdb.png`,
  `/logos/letterboxd.png`,
  `/logos/rottentomatoes.png`,
  `/logos/metacritic.png`,
  `/logos/metacritic_audience.png`,
  `/logos/tmdb.png`,
  `/logos/trakt.png`
];

const formatQueryError = (error: unknown): { status: FetchStatus; detail: string } => {
  return {
    status: 'error',
    detail: error instanceof Error ? error.message : String(error)
  };
};

export default function TVShowPage() {
  const { id } = useParams();
  const [selectedSeason, setSelectedSeason] = useState<number | undefined>(undefined);
  const [isExporting, setIsExporting] = useState(false);
  const exportSeasonRef = useRef<number | undefined>(undefined);

  const {
    platformStatuses,
    tmdbStatus,
    traktStatus,
    tmdbRating,
    traktRating,
    retryCount,
    handleRetry
  } = useMediaRatings({ mediaId: id, mediaType: 'tv' });
  
  const [posterBase64, setPosterBase64] = useState<string | null>(null);

  const { data: tvShow, isLoading, error: queryError } = useQuery({
    queryKey: ['tvshow', id],
    queryFn: () => getTVShow(id!),
    enabled: !!id,
    staleTime: Infinity
  });

  useDetailViewTracking({
    mediaType: 'tv',
    mediaId: id,
    mediaLoaded: !!tvShow,
    title: tvShow?.title,
    platformStatuses,
    tmdbStatus,
    traktStatus,
  });

  useEffect(() => {
    preloadImages({
      cdnImages: PRELOAD_IMAGES
    }).catch(error => {
      console.warn('图片预加载失败:', error);
    });
  }, []);

  useEffect(() => {
    if (tvShow) {
      preloadImages({
        poster: tvShow.poster,
        cdnImages: [
          `/logos/douban.png`,
          `/logos/imdb.png`,
          `/logos/letterboxd.png`,
          `/logos/rottentomatoes.png`,
          `/logos/metacritic.png`,
          `/logos/metacritic_audience.png`,
          `/logos/tmdb.png`,
          `/logos/trakt.png`
        ]
      }).catch(error => {
        console.warn('图片预加载失败:', error);
      });
    }
  }, [tvShow]);

  useEffect(() => {
    if (tvShow?.poster) {
      getBase64ImageWithOptions(tvShow.poster, { cacheBust: false })
        .then(base64 => setPosterBase64(base64))
        .catch(error => console.error('Failed to convert poster to base64:', error));
    }
  }, [tvShow]);

  const allRatings: TVShowRatingData = {
    type: 'tv',
    douban: platformStatuses.douban.data,
    imdb: platformStatuses.imdb.data,
    letterboxd: platformStatuses.letterboxd.data,
    rottentomatoes: platformStatuses.rottentomatoes.data,
    metacritic: platformStatuses.metacritic.data,
    tmdb: tmdbRating ?? undefined,
    trakt: traktRating ?? undefined
  };

  const backendPlatforms: BackendPlatformStatus[] = [
    {
      platform: 'douban',
      logo: `/logos/douban.png`,
      status: platformStatuses.douban.status
    },
    {
      platform: 'imdb',
      logo: `/logos/imdb.png`,
      status: platformStatuses.imdb.status
    },
    {
      platform: 'letterboxd',
      logo: `/logos/letterboxd.png`,
      status: platformStatuses.letterboxd.status
    },
    {
      platform: 'rottentomatoes',
      logo: `/logos/rottentomatoes.png`,
      status: platformStatuses.rottentomatoes.status
    },
    {
      platform: 'metacritic',
      logo: `/logos/metacritic.png`,
      status: platformStatuses.metacritic.status
    }
  ];


  const handleSeasonChange = async (season: number | undefined) => {
    exportSeasonRef.current = season;
    setSelectedSeason(season);
  };

  const handleExport = async (layout: ExportLayout) => {
    const seasonToExport = exportSeasonRef.current;

    if (!tvShow || isExporting) return;
    setIsExporting(true);

    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => resolve(null), 0);
        });
      });
    });

    try {
      const element = document.getElementById(`export-content-${layout}`);
      if (!element) throw new Error('导出元素不存在');
      
      let fileName = `${tvShow.title} (${tvShow.year})`;
      if (seasonToExport) {
        fileName += ` S${seasonToExport.toString().padStart(2, '0')}`;
      }
      fileName = fileName.replace(/[/\\?%*:|"<>]/g, '-');

      await exportToPng(element, `${fileName}.png`, {
        cacheKey: `tv:${id}:${layout}:${seasonToExport || 0}:${document.documentElement.getAttribute('data-theme') || 'light'}`,
      });
    } catch (error) {
      console.error('导出失败:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const episodeCount = tvShow?.seasons?.reduce((total, season) => 
    total + (season.episodeCount || 0), 0) || 0;

  const seasonCount = tvShow?.seasons?.filter(season => 
    season.seasonNumber > 0).length || 0;

  const overallRating = tvShow
    ? calculateOverallRating(allRatings, 'tvshow')
    : null;

  const title = tvShow?.title || '剧集详情';
  const yearSuffix = tvShow?.firstAirDate ? ` (${tvShow.firstAirDate.slice(0, 4)})` : '';
  usePageMeta({
    title: `${title}${yearSuffix} - RateFuse`,
    description: tvShow?.overview
      ? `${tvShow.overview.slice(0, 120)}${tvShow.overview.length > 120 ? '…' : ''}`
      : '在 RateFuse 查看并对比多平台剧集评分，并导出评分卡片。',
    canonicalPath: id ? `/tv/${id}` : undefined,
    ogImage: tvShow?.poster || undefined,
    jsonLd: tvShow
      ? {
          '@context': 'https://schema.org',
          '@type': 'TVSeries',
          name: tvShow.title,
          image: tvShow.poster,
          description: tvShow.overview,
          datePublished: tvShow.firstAirDate,
          aggregateRating: overallRating?.rating
            ? {
                '@type': 'AggregateRating',
                ratingValue: overallRating.rating,
                bestRating: 10,
                worstRating: 0,
              }
            : undefined,
        }
      : null,
    jsonLdId: 'structured-data-media',
  });

  const getCurrentPlatform = (): string => {
    const backendErrorPlatform = backendPlatforms.find(p => p.status === 'error')?.platform;
    if (backendErrorPlatform) return backendErrorPlatform;
    if (tmdbStatus === 'error') return 'tmdb';
    if (traktStatus === 'error') return 'trakt';
    return 'unknown';
  };

  if (queryError) {
    return (
      <PageShell maxWidth="7xl" contentClassName="flex items-center justify-center py-12">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Error</h2>
            <p className="text-gray-600 dark:text-gray-400">{messages.errors.loadMovieFailed}</p>
          </div>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="full" contentClassName="px-0" withTopOffset={false} navPanelClassName="nav-glass-exempt">
        {tvShow && (
          <>
            <FavoriteButton 
              mediaId={id || ''}
              mediaType="tv"
              title={tvShow.title || ''}
              poster={tvShow.poster}
              year={String(tvShow.year || '')}
              overview={tvShow.overview}
            />
            <ExportButton 
              onExport={handleExport}
              seasons={tvShow?.seasons}
              selectedSeason={selectedSeason}
              onSeasonChange={handleSeasonChange}
              isExporting={isExporting}
            />
          </>
        )}

        <div className="tv-show-content">
          {isLoading || !tvShow ? (
            <div className="pt-20 sm:pt-24">
              <MediaPageSkeleton variant="tv" />
            </div>
          ) : (
            <>
              <TVShowHero 
                tvShow={tvShow as TVShow} 
                backdropUrl={tvShow.backdrop}
                ratingData={allRatings}
                titleRight={
                  overallRating?.rating ? (
                    <OverallRatingCard
                      rating={overallRating.rating}
                      validPlatformsCount={overallRating.validRatings}
                    />
                  ) : null
                }
                bottomRight={
                  <div className="w-full flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <TVShowMetadata
                        status={tvShow.status || ''}
                        firstAirDate={tvShow.firstAirDate || ''}
                        lastAirDate={tvShow.lastAirDate || ''}
                        episodeCount={episodeCount}
                        seasonCount={seasonCount}
                        genres={tvShow.genres || []}
                        useContainer={false}
                        className="bg-white/90 dark:bg-[var(--card-bg)]"
                      />
                    </div>
                    {overallRating?.rating && (
                      <div className="flex-shrink-0 sm:hidden">
                        <OverallRatingCard
                          rating={overallRating.rating}
                          validPlatformsCount={overallRating.validRatings}
                        />
                      </div>
                    )}
                  </div>
                }
                rightPanel={
                  <div className="glass-card glass-exempt rounded-lg p-4 sm:p-5 h-full flex flex-col">
                    <div className="w-full">
                      <div className="text-sm font-semibold text-white/90 text-protection">
                        数据来源状态
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 justify-start w-full">
                        <PlatformStatusBar
                          backendStatuses={backendPlatforms}
                          tmdbStatus={tmdbStatus}
                          traktStatus={traktStatus}
                          onRetry={handleRetry}
                        />
                      </div>
                      <div className="mt-2 text-xs text-white/80 text-protection">
                        失败可重试，并非所有剧集都有 Letterboxd 评分，请耐心
                      </div>
                    </div>

                    <div className="mt-5 flex-1 flex flex-col">
                      <div className="flex items-baseline justify-between gap-3">
                        <h2 className="text-lg sm:text-xl font-bold text-white text-protection">
                          平台评分
                        </h2>
                      </div>
                      <div className="mt-4 flex-1">
                        <TVShowRatingGrid
                          ratingData={allRatings}
                          tvShow={tvShow}
                          onRetry={() => handleRetry(getCurrentPlatform())}
                          cardSize="compact"
                          columns="two"
                        />
                      </div>
                    </div>
                  </div>
                }
              />
              {tvShow && id && (
                <ResourceSection mediaType="tv" tmdbId={id} title={tvShow.title} year={tvShow.year} />
              )}

              {tvShow.seasons && tvShow.seasons.length > 0 && (
                <div className="container mx-auto px-4 py-8 content-container">
                  <section>
                    <h2 className="text-2xl font-bold mb-4 dark:text-white">季度评分</h2>
                    <SeasonRatings
                      seasons={tvShow.seasons}
                      ratingData={allRatings}
                      tvShow={tvShow}
                      onRetry={handleRetry}
                    />
                  </section>
                </div>
              )}

              <Credits
                cast={tvShow.credits.cast}
                crew={tvShow.credits.crew}
              />
            </>
          )}
        </div>

        <div className="fixed left-0 top-0 -z-50 pointer-events-none opacity-0">
          <div id="export-content-portrait" style={{ width: '887px', overflow: 'hidden' }}>
            {tvShow && (
              <ExportTVShowRatingCard
                tvShow={{
                  ...tvShow,
                  poster: posterBase64 || tvShow.poster
                }}
                ratingData={allRatings}
                selectedSeason={selectedSeason}
                layout="portrait"
              />
            )}
          </div>
          <div id="export-content-landscape" style={{ width: '1200px', overflow: 'hidden' }}>
            {tvShow && (
              <ExportTVShowRatingCard
                tvShow={{
                  ...tvShow,
                  poster: posterBase64 || tvShow.poster
                }}
                ratingData={allRatings}
                selectedSeason={selectedSeason}
                layout="landscape"
              />
            )}
          </div>
        </div>

        {queryError && (
          <ErrorMessage
            status={formatQueryError(queryError).status}
            errorDetail={formatQueryError(queryError).detail}
            onRetry={() => {
              const platformToRetry = backendPlatforms.find(p => p.status === 'error')?.platform || 'unknown';
              handleRetry(platformToRetry);
            }}
            retryCount={retryCount[backendPlatforms.find(p => p.status === 'error')?.platform || 'unknown'] || 0}
          />
        )}
    </PageShell>
  );
}
