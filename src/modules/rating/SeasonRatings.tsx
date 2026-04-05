// ==========================================
// 分季评分展示组件
// ==========================================
import type { TVShowRatingData } from '../../modules/rating/ratings';
import type { FetchStatus } from '../../shared/types/status';
import type { TVShow } from '../../shared/types/media';
import { ErrorMessage } from '../../shared/ui/ErrorMessage';
import { TVShowRatingGrid } from './TVShowRatingGrid';
import { isValidRatingData } from '../../modules/rating/ratingHelpers';
import { calendarYearFromIsoDate } from '../../shared/utils/time';

interface SeasonRatingsProps {
  seasons: {
    seasonNumber: number;
    name: string;
    episodeCount: number;
    airDate: string;
    poster?: string;
  }[];
  ratingData: TVShowRatingData;
  tvShow: TVShow;
  error?: {
    status: FetchStatus;
    detail: string;
  };
  onRetry: (platform: string) => void;
}

export function SeasonRatings({ 
  seasons, 
  ratingData,
  tvShow,
  error,
  onRetry 
}: SeasonRatingsProps) {
  if (!seasons?.length) return null;

  if (error) {
    return (
      <ErrorMessage
        status={error.status}
        errorDetail={error.detail}
        onRetry={() => onRetry('platform')}
      />
    );
  }

  return (
    <div className="space-y-8">
      {seasons.map((season) => {
        if (!season.seasonNumber) return null;

        const doubanSeason = ratingData.douban?.seasons?.find(s => 
          s.season_number === season.seasonNumber
        );
        const doubanRating = doubanSeason?.rating || (season.seasonNumber === 1 ? ratingData.douban?.rating : undefined);

        const rtRating = ratingData.rottentomatoes?.seasons?.find(s => 
          s.season_number === season.seasonNumber
        );

        const mcRating = ratingData.metacritic?.seasons?.find(s => 
          s.season_number === season.seasonNumber
        );

        const hasValidRatings = 
          isValidRatingData(doubanRating) ||
          (rtRating && (
            isValidRatingData(rtRating.tomatometer) ||
            isValidRatingData(rtRating.audience_score)
          )) ||
          (mcRating && (
            isValidRatingData(mcRating.metascore) ||
            isValidRatingData(mcRating.userscore)
          )) ||
          (ratingData.tmdb?.seasons?.some(s => 
            s.season_number === season.seasonNumber && 
            s.rating > 0
          )) ||
          (ratingData.trakt?.seasons?.some(s =>
            s.season_number === season.seasonNumber &&
            s.rating > 0
          ));

        if (!hasValidRatings) return null;

        return (
          <div key={season.seasonNumber} className="glass rounded-lg p-6">
            <div className="mb-3">
              <h4 className="text-lg font-medium dark:text-white">
                {season.seasonNumber === 0 ? '特别篇' : `第 ${season.seasonNumber} 季`}
              </h4>
              <p className="text-sm dark:text-gray-300">
                {season.episodeCount} 集 • {calendarYearFromIsoDate(season.airDate) ?? '—'}
              </p>
            </div>
            <TVShowRatingGrid 
              ratingData={ratingData}
              selectedSeason={season.seasonNumber}
              tvShow={tvShow}
              onRetry={() => onRetry('platform')}
            />
          </div>
        );
      })}
    </div>
  );
} 
