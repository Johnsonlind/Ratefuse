// ==========================================
// 剧集总评分算法
// ==========================================
import { TVShowRatingData } from '../../modules/rating/ratings';
import { calculateMedianVoteCount, aggregateDoubanSeasonRatings } from './ratingHelpers';
import {
  createRatingCalculationState,
  calculateFinalRating,
  processDoubanRating,
  processIMDBRating,
  processRottenTomatoesRating,
  processMetacriticRating,
  processTMDBRating,
  processTraktRating,
  processLetterboxdRating
} from './ratingCalculators';

export function calculateTVShowOverallRating(ratingData: TVShowRatingData) {
  const state = createRatingCalculationState();
  const medianVoteCount = calculateMedianVoteCount(ratingData);
  let effectiveRatingData: TVShowRatingData = ratingData;

  const doubanSeasonsFromDouban = ratingData.douban?.seasons ?? [];
  const doubanSeasonsFromRoot =
    ratingData.seasons
      ?.filter((s) => s.douban && s.douban.rating && s.douban.rating_people)
      .map((s) => ({
        rating: s.douban!.rating,
        rating_people: s.douban!.rating_people,
      })) ?? [];

  const allDoubanSeasons =
    doubanSeasonsFromDouban.length > 0
      ? doubanSeasonsFromDouban
      : doubanSeasonsFromRoot;

  if (ratingData.douban && allDoubanSeasons.length > 1) {
    const aggregated = aggregateDoubanSeasonRatings(allDoubanSeasons);
    if (aggregated) {
      const aggregatedDouban = {
        ...ratingData.douban,
        rating: aggregated.rating,
        rating_people: aggregated.rating_people,
      };
      effectiveRatingData = { ...ratingData, douban: aggregatedDouban };
      processDoubanRating(
        effectiveRatingData,
        medianVoteCount,
        state
      );
    }
  } else {
    processDoubanRating(ratingData, medianVoteCount, state);
  }
  processIMDBRating(effectiveRatingData, medianVoteCount, state);
  processRottenTomatoesRating(effectiveRatingData, medianVoteCount, state);
  processMetacriticRating(effectiveRatingData, medianVoteCount, state);
  processTMDBRating(effectiveRatingData, medianVoteCount, state);
  processTraktRating(effectiveRatingData, medianVoteCount, state);
  processLetterboxdRating(effectiveRatingData, medianVoteCount, state);

  const finalRating = calculateFinalRating(state);

  if (process.env.NODE_ENV === 'development') {
    console.log('剧集计算详情:', {
      中位数评分人数: medianVoteCount,
      各平台评分详情: state.ratingDetails,
      有效平台数: state.validPlatforms.length,
      参与计算的平台: state.validPlatforms,
      最终评分: finalRating,
      原始评分数据: {
        douban: effectiveRatingData.douban,
        imdb: effectiveRatingData.imdb,
        rottenTomatoes: effectiveRatingData.rottentomatoes?.series,
        metacritic: effectiveRatingData.metacritic?.overall,
        tmdb: effectiveRatingData.tmdb,
        trakt: effectiveRatingData.trakt,
        letterboxd: effectiveRatingData.letterboxd
      }
    });
  }

  return {
    rating: finalRating,
    validRatings: state.validPlatforms.length,
    platforms: state.validPlatforms
  };
}
