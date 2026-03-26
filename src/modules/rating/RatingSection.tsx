// ==========================================
// 评分区域容器组件
// ==========================================
import { useState, useEffect } from 'react';
import { MovieRatingGrid } from './MovieRatingGrid';
import { TVShowRatingGrid } from './TVShowRatingGrid';
import { PlatformStatusBar } from './PlatformStatusBar';
import type { Movie, TVShow } from '../../shared/types/media';
import type { MovieRatingData, RatingData, TVShowRatingData } from '../../modules/rating/ratings';
import type { FetchStatus, BackendPlatformStatus } from '../../shared/types/status';
import { SeasonRatings } from './SeasonRatings';
import ErrorMessage from '../../shared/ui/ErrorMessage';
import { calculateOverallRating } from '../../modules/rating/calculateOverallRating';
import { OverallRatingCard } from './OverallRatingCard';
import { cn } from '../../shared/utils/utils';
import type { CalculatedRating } from '../../modules/rating/ratings';
import React from 'react';

interface RatingSectionProps {
  media: Movie | TVShow;
  ratingData?: RatingData;
  isLoading: boolean;
  error?: {
    status: FetchStatus;
    detail: string;
  };
  tmdbStatus: FetchStatus;
  traktStatus: FetchStatus;
  backendPlatforms: BackendPlatformStatus[];
  onRetry: (platform: string) => void;
}

export const RatingSection = React.memo(function RatingSection({ 
  media, 
  ratingData, 
  isLoading, 
  error,
  tmdbStatus,
  traktStatus,
  backendPlatforms,
  onRetry
}: RatingSectionProps) {
  const isTVShow = media.type === 'tv';
  const hasSeasons = isTVShow && 'seasons' in media && (media as TVShow).seasons?.length > 0;
  
  const [realTimeRating, setRealTimeRating] = useState<CalculatedRating | null>(null);

  useEffect(() => {
    if (ratingData) {
      const newRating = calculateOverallRating(ratingData, isTVShow ? 'tvshow' : 'movie');
      setRealTimeRating(newRating);
    }
  }, [ratingData, isTVShow]);

  const hasSeasonRatings = isTVShow && ratingData && (
    (ratingData.douban?.seasons?.length ?? 0) > 0 || 
    (ratingData.rottentomatoes?.seasons?.length ?? 0) > 0 || 
    (ratingData.metacritic?.seasons?.length ?? 0) > 0 ||
    (ratingData.tmdb?.seasons?.length ?? 0) > 0
  );

  const containerStyle = "bg-[var(--card-bg)] rounded-lg p-6";

  const getCurrentPlatform = () => {
    if (error) {
      const errorPlatform = backendPlatforms.find(p => p.status === 'error');
      if (errorPlatform) {
        return errorPlatform.platform;
      }
    }
    return 'unknown';
  };

  return (
    <div className="container mx-auto px-4 py-8 content-container">
      {/* 综合评分 */}
      {realTimeRating?.rating && (
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-protection dark:text-white">综合评分</h2>
          <OverallRatingCard 
            rating={realTimeRating.rating} 
            validPlatformsCount={realTimeRating.platforms.length}
          />
        </section>
      )}

      {/* 评分状态 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold mb-4 dark:text-white text-protection">数据来源</h2>
        <div className="flex flex-wrap gap-3">
          <PlatformStatusBar
            backendStatuses={backendPlatforms}
            tmdbStatus={tmdbStatus}
            traktStatus={traktStatus}
            onRetry={onRetry}
          />
        </div>
      </section>

      {/* 评分标题和内容区域 */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold mb-4 dark:text-white">
          {isTVShow ? '剧集评分' : '评分'}
        </h2>
        
        <div className={cn("p-6 rounded-lg glass", containerStyle)}>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-4"></div>
              <p className="text-gray-400">正在获取评分数据...</p>
            </div>
          ) : error ? (
            <ErrorMessage
              status={error.status}
              errorDetail={error.detail}
              onRetry={() => onRetry(getCurrentPlatform())}
            />
          ) : (
            isTVShow ? (
              <TVShowRatingGrid 
                ratingData={ratingData as TVShowRatingData} 
                onRetry={() => onRetry(getCurrentPlatform())}
                tvShow={media as TVShow}
              />
            ) : (
              <MovieRatingGrid 
                ratingData={ratingData as MovieRatingData} 
                onRetry={() => onRetry(getCurrentPlatform())}
                movie={media as Movie}
              />
            )
          )}
        </div>
      </section>

      {/* 季度评分部分 */}
      {hasSeasons && hasSeasonRatings && (
        <section>
          <h2 className="text-2xl font-bold mb-4 dark:text-white">季度评分</h2>
          <SeasonRatings
            seasons={(media as TVShow).seasons}
            ratingData={ratingData as TVShowRatingData}
            tvShow={media as TVShow}
            error={error}
            onRetry={onRetry}
          />
        </section>
      )}
    </div>
  );
});
