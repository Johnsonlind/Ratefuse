// ==========================================
// 电影详情页
// ==========================================
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MovieHero } from '../modules/media/MovieHero';
import { Credits } from '../modules/media/Credits';
import { getMovie } from '../api/movies';
import { messages } from '../shared/utils/messages';
import { exportToPng, preloadImages } from '../modules/export/export';
import { ExportRatingCard } from '../modules/export/ExportRatingCard';
import { MovieMetadata } from '../modules/media/MovieMetadata';
import type { FetchStatus, BackendPlatformStatus } from '../shared/types/status';
import { MovieRatingData } from '../modules/rating/ratings';
import { Movie as MediaMovie } from '../shared/types/media';
import { getBase64ImageWithOptions } from '../api/image';
import { ExportButton, type ExportLayout } from '../modules/export/ExportButton';
import { FavoriteButton } from '../modules/favorite/FavoriteButton';
import { ErrorMessage } from '../shared/ui/ErrorMessage';
import { useMediaRatings } from '../modules/rating/useMediaRatings';
import { MediaPageSkeleton } from '../modules/media/MediaPageSkeleton';
import { MovieRatingGrid } from '../modules/rating/MovieRatingGrid';
import { PlatformStatusBar } from '../modules/rating/PlatformStatusBar';
import { calculateOverallRating } from '../modules/rating/calculateOverallRating';
import { OverallRatingCard } from '../modules/rating/OverallRatingCard';
import { PageShell } from '../modules/layout/PageShell';
import { usePageMeta } from '../shared/hooks/usePageMeta';
import { authFetch } from '../api/authFetch';
import { ResourceSection } from '../modules/resources/ResourceSection';

const PRELOAD_IMAGES = [
  '/logos/douban.png',
  '/logos/imdb.png',
  '/logos/letterboxd.png',
  '/logos/rottentomatoes.png',
  '/logos/metacritic.png',
  '/logos/metacritic_audience.png',
  '/logos/tmdb.png',
  '/logos/trakt.png'
];

const formatQueryError = (error: unknown): { status: FetchStatus; detail: string } => {
  return {
    status: 'error',
    detail: error instanceof Error ? error.message : String(error)
  };
};

export default function MoviePage() {
  const { id } = useParams();
  const [isExporting, setIsExporting] = useState(false);
  const [trackedId, setTrackedId] = useState<string | null>(null);
  
  const {
    platformStatuses,
    tmdbStatus,
    traktStatus,
    tmdbRating,
    traktRating,
    retryCount,
    handleRetry
  } = useMediaRatings({ mediaId: id, mediaType: 'movie' });

  const { data: movie, isLoading, error: queryError } = useQuery({
    queryKey: ['movie', id],
    queryFn: () => getMovie(id!),
    enabled: !!id,
    staleTime: Infinity
  });

  const [posterBase64, setPosterBase64] = useState<string | null>(null);

  useEffect(() => {
    preloadImages({
      cdnImages: PRELOAD_IMAGES
    }).catch(error => {
      console.warn('图片预加载失败:', error);
    });
  }, []);

  useEffect(() => {
    if (movie) {
      preloadImages({
        poster: movie.poster,
        cdnImages: PRELOAD_IMAGES
      }).catch(error => {
        console.warn('图片预加载失败:', error);
      });
    }
  }, [movie]);

  useEffect(() => {
    if (!id || !movie) return;
    const title = String(movie.title || '').trim();
    if (!title) return;
    if (trackedId === id) return;

    const url = `${window.location.origin}${window.location.pathname}`;
    const n = Number(id);
    const tmdbNum = Number.isFinite(n) ? n : undefined;

    setTrackedId(id);
    authFetch('/api/track/detail-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'movie',
        tmdb_id: tmdbNum,
        title,
        url,
        platform_rating_fetch_statuses: {
          douban: platformStatuses.douban.status,
          imdb: platformStatuses.imdb.status,
          letterboxd: platformStatuses.letterboxd.status,
          rottentomatoes: platformStatuses.rottentomatoes.status,
          metacritic: platformStatuses.metacritic.status,
          tmdb: tmdbStatus,
          trakt: traktStatus,
        },
      }),
      withAuth: true,
      keepalive: true,
    })
      .catch(() => {
        setTrackedId((prev) => (prev === id ? null : prev));
      });
  }, [id, movie, trackedId]);

  useEffect(() => {
    if (movie?.poster) {
      getBase64ImageWithOptions(movie.poster, { cacheBust: false })
        .then(base64 => setPosterBase64(base64))
        .catch(error => console.error('Failed to convert poster to base64:', error));
    }
  }, [movie]);

  const allRatings: MovieRatingData = {
    type: 'movie',
    douban: platformStatuses.douban?.data,
    imdb: platformStatuses.imdb?.data,
    letterboxd: platformStatuses.letterboxd?.data,
    rottentomatoes: platformStatuses.rottentomatoes?.data,
    metacritic: platformStatuses.metacritic?.data,
    tmdb: tmdbRating ?? null,
    trakt: traktRating ?? null
  };

  const backendPlatforms: BackendPlatformStatus[] = [
    {
      platform: 'douban',
      logo: '/logos/douban.png',
      status: platformStatuses.douban.status
    },
    {
      platform: 'imdb',
      logo: '/logos/imdb.png',
      status: platformStatuses.imdb.status
    },
    {
      platform: 'letterboxd',
      logo: '/logos/letterboxd.png',
      status: platformStatuses.letterboxd.status
    },
    {
      platform: 'rottentomatoes',
      logo: '/logos/rottentomatoes.png',
      status: platformStatuses.rottentomatoes.status
    },
    {
      platform: 'metacritic',
      logo: '/logos/metacritic.png',
      status: platformStatuses.metacritic.status
    }
  ];

  const overallRating = calculateOverallRating(allRatings, 'movie');

  const title = movie?.title || '电影详情';
  const yearSuffix = movie?.releaseDate ? ` (${movie.releaseDate.slice(0, 4)})` : '';
  usePageMeta({
    title: `${title}${yearSuffix} - RateFuse`,
    description: movie?.overview
      ? `${movie.overview.slice(0, 120)}${movie.overview.length > 120 ? '…' : ''}`
      : '在 RateFuse 查看并对比多平台电影评分，并导出评分卡片。',
    canonicalPath: id ? `/movie/${id}` : undefined,
    ogImage: movie?.poster || undefined,
    jsonLd: movie
      ? {
          '@context': 'https://schema.org',
          '@type': 'Movie',
          name: movie.title,
          image: movie.poster,
          datePublished: movie.releaseDate,
          description: movie.overview,
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

  const handleExport = async (layout: ExportLayout) => {
    if (!movie || isExporting) return;

    const hasValidRatings = Object.values(allRatings).some(rating =>
      rating && typeof rating === 'object' && Object.keys(rating).length > 0
    );

    if (!hasValidRatings) {
      console.error('没有有效的评分数据可供导出');
      return;
    }

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

      const fileName = `${movie.title} (${movie.year})`.replace(/[/\\?%*:|"<>]/g, '-');
      await exportToPng(element, `${fileName}.png`, {
        cacheKey: `movie:${id}:${layout}:${document.documentElement.getAttribute('data-theme') || 'light'}`,
      });
    } catch (error) {
      console.error('导出失败:', error);
    } finally {
      setIsExporting(false);
    }
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
        {movie && (
          <>
            <FavoriteButton
              mediaId={id || ''}
              mediaType="movie"
              title={movie.title}
              poster={movie.poster}
              year={String(movie.year || '')}
              overview={movie.overview}
            />
            <ExportButton onExport={handleExport} isExporting={isExporting} />
          </>
        )}

        <div className="movie-content">
          {isLoading || !movie ? (
            <div className="pt-20 sm:pt-24">
              <MediaPageSkeleton variant="movie" />
            </div>
          ) : (
            <>
              <MovieHero
                movie={{
                  ...movie,
                  runtime: movie.runtime || 0
                } as MediaMovie}
                backdropUrl={movie.backdrop}
                ratingData={allRatings}
                titleRight={
                  overallRating?.rating ? (
                    <OverallRatingCard
                      rating={overallRating.rating}
                      validPlatformsCount={overallRating.platforms.length}
                    />
                  ) : null
                }
                posterBelow={null}
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
                        失败可重试，Letterboxd 请耐心
                      </div>
                    </div>

                    <div className="mt-5 flex-1 flex flex-col">
                      <div className="flex items-baseline justify-between gap-3">
                        <h2 className="text-lg sm:text-xl font-bold text-white text-protection">
                          平台评分
                        </h2>
                      </div>
                      <div className="mt-4 flex-1">
                        <MovieRatingGrid
                          ratingData={allRatings}
                          movie={movie as MediaMovie}
                          onRetry={() => handleRetry(getCurrentPlatform())}
                          cardSize="compact"
                        />
                      </div>
                    </div>
                  </div>
                }
                bottomRight={
                  <div className="w-full flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <MovieMetadata
                        runtime={movie.runtime}
                        releaseDate={movie.releaseDate}
                        genres={movie.genres}
                        useContainer={false}
                        className="bg-white/90 dark:bg-[var(--card-bg)]"
                      />
                    </div>
                    {overallRating?.rating && (
                      <div className="flex-shrink-0 sm:hidden">
                        <OverallRatingCard
                          rating={overallRating.rating}
                          validPlatformsCount={overallRating.platforms.length}
                        />
                      </div>
                    )}
                  </div>
                }
              />
              {movie && id && (
                <ResourceSection mediaType="movie" tmdbId={id} title={movie.title} year={movie.year} />
              )}

              <Credits
                cast={movie.credits.cast}
                crew={movie.credits.crew}
              />
            </>
          )}
        </div>

        <div className="fixed left-0 top-0 -z-50 pointer-events-none opacity-0">
          <div id="export-content-portrait" style={{ width: '887px', overflow: 'hidden' }}>
            {movie && (
              <ExportRatingCard
                media={{
                  title: movie.title,
                  year: movie.year.toString(),
                  poster: posterBase64 || movie.poster
                }}
                ratingData={allRatings}
                layout="portrait"
              />
            )}
          </div>
          <div id="export-content-landscape" style={{ width: '1200px', overflow: 'hidden' }}>
            {movie && (
              <ExportRatingCard
                media={{
                  title: movie.title,
                  year: movie.year.toString(),
                  poster: posterBase64 || movie.poster
                }}
                ratingData={allRatings}
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
