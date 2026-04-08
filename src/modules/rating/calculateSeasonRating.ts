// ==========================================
// 分季评分算法
// ==========================================
import { SeasonRatingData } from '../../modules/rating/ratings';
import { calculateMedianVoteCount } from './ratingHelpers';
import {
  createRatingCalculationState,
  calculateFinalRating,
  processDoubanRating,
  processRottenTomatoesRating,
  processMetacriticRating,
  processTMDBRating,
  processTraktRating
} from './ratingCalculators';

export function calculateSeasonRating(ratings: SeasonRatingData, seasonNumber: number) {
  const state = createRatingCalculationState();
  const medianVoteCount = calculateMedianVoteCount(ratings);

  processDoubanRating(ratings, medianVoteCount, state, seasonNumber);
  processRottenTomatoesRating(ratings, medianVoteCount, state, seasonNumber);
  processMetacriticRating(ratings, medianVoteCount, state, seasonNumber);
  processTMDBRating(ratings, medianVoteCount, state, seasonNumber);
  processTraktRating(ratings, medianVoteCount, state, seasonNumber);

  const finalRating = calculateFinalRating(state);

  if (process.env.NODE_ENV === 'development') {
    console.log('分季评分计算详情:', {
      季数: seasonNumber,
      中位数评分人数: medianVoteCount,
      各平台评分详情: state.ratingDetails,
      有效平台数: state.validPlatforms.length,
      参与计算的平台: state.validPlatforms,
      最终评分: finalRating,
      原始评分数据: {
        douban: ratings.douban?.seasons?.find((s: { season_number: number }) => s.season_number === seasonNumber),
        rottenTomatoes: ratings.rottentomatoes?.seasons?.find((s: { season_number: number }) => s.season_number === seasonNumber),
        metacritic: ratings.metacritic?.seasons?.find((s: { season_number: number }) => s.season_number === seasonNumber),
        tmdb: ratings.tmdb?.seasons?.find((s: { season_number: number }) => s.season_number === seasonNumber),
        trakt: ratings.trakt?.seasons?.find((s: { season_number: number }) => s.season_number === seasonNumber)
      }
    });
  }

  return {
    rating: finalRating,
    validRatings: state.validPlatforms.length,
    platforms: state.validPlatforms
  };
}
