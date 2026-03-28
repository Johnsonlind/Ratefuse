// ==========================================
// 综合评分算法（通用）
// ==========================================
import type { RatingData, TVShowRatingData } from '../../modules/rating/ratings';
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

export function calculateOverallRating(
  ratingData: RatingData | TVShowRatingData,
  type: 'movie' | 'tvshow' = 'movie'
): { rating: number | null; validRatings: number; platforms: string[] } {
  if (!ratingData) return { rating: null, validRatings: 0, platforms: [] };

  const state = createRatingCalculationState();
  const medianVoteCount = calculateMedianVoteCount(ratingData);
  let effectiveRatingData: RatingData | TVShowRatingData = ratingData;

  if (type === 'movie') {
    processDoubanRating(ratingData, medianVoteCount, state);
    processIMDBRating(ratingData, medianVoteCount, state);
    processRottenTomatoesRating(ratingData, medianVoteCount, state);
    processMetacriticRating(ratingData, medianVoteCount, state);
    processTMDBRating(ratingData, medianVoteCount, state);
    processTraktRating(ratingData, medianVoteCount, state);
    processLetterboxdRating(ratingData, medianVoteCount, state);
  } 
  else {
    const tvData = ratingData as TVShowRatingData;
    let effectiveTvData: TVShowRatingData = tvData;

    const doubanSeasonsFromDouban = tvData.douban?.seasons ?? [];
    const doubanSeasonsFromRoot =
      tvData.seasons
        ?.filter((s) => s.douban && s.douban.rating && s.douban.rating_people)
        .map((s) => ({
          season_number: s.season_number,
          rating: s.douban!.rating,
          rating_people: s.douban!.rating_people,
        })) ?? [];

    const allDoubanSeasons =
      doubanSeasonsFromDouban.length > 0
        ? doubanSeasonsFromDouban
        : doubanSeasonsFromRoot;

    if (tvData.douban && allDoubanSeasons.length > 1) {
      const aggregated = aggregateDoubanSeasonRatings(allDoubanSeasons);
      if (aggregated) {
        const aggregatedDouban = {
          ...tvData.douban,
          rating: aggregated.rating,
          rating_people: aggregated.rating_people,
        };
        effectiveTvData = { ...tvData, douban: aggregatedDouban };
        effectiveRatingData = effectiveTvData;
        processDoubanRating(effectiveTvData, medianVoteCount, state);
      }
    } else if (tvData.douban && allDoubanSeasons.length === 1) {
      const onlySeason = allDoubanSeasons[0];
      processDoubanRating(
        effectiveTvData,
        medianVoteCount,
        state,
        onlySeason.season_number
      );
    } else {
      processDoubanRating(effectiveTvData, medianVoteCount, state);
    }

    if (allDoubanSeasons.length > 1) {
      allDoubanSeasons.forEach((season) => {
        processDoubanRating(
          effectiveTvData,
          medianVoteCount,
          state,
          season.season_number
        );
      });
    }
    processIMDBRating(effectiveTvData, medianVoteCount, state);
    processRottenTomatoesRating(effectiveTvData, medianVoteCount, state);
    processMetacriticRating(effectiveTvData, medianVoteCount, state);
    processLetterboxdRating(effectiveTvData, medianVoteCount, state);
    processTMDBRating(effectiveTvData, medianVoteCount, state);
    processTraktRating(effectiveTvData, medianVoteCount, state);

    if (effectiveTvData.rottentomatoes?.seasons) {
      effectiveTvData.rottentomatoes.seasons.forEach(season => {
        processRottenTomatoesRating(
          effectiveTvData,
          medianVoteCount,
          state,
          season.season_number
        );
      });
    }

    if (effectiveTvData.metacritic?.seasons) {
      effectiveTvData.metacritic.seasons.forEach(season => {
        processMetacriticRating(
          effectiveTvData,
          medianVoteCount,
          state,
          season.season_number
        );
      });
    }

    if (effectiveTvData.tmdb?.seasons) {
      effectiveTvData.tmdb.seasons.forEach(season => {
        processTMDBRating(
          effectiveTvData,
          medianVoteCount,
          state,
          season.season_number
        );
      });
    }

    if (effectiveTvData.trakt?.seasons) {
      effectiveTvData.trakt.seasons.forEach(season => {
        processTraktRating(
          effectiveTvData,
          medianVoteCount,
          state,
          season.season_number
        );
      });
    }
  }

  const finalRating = calculateFinalRating(state);

  if (process.env.NODE_ENV === 'development') {
    console.log('综合评分计算详情:', {
      类型: type,
      中位数评分人数: medianVoteCount,
      各平台评分详情: state.ratingDetails,
      有效平台数: state.validPlatforms.length,
      参与计算的平台: state.validPlatforms,
      最终评分: finalRating,
      原始评分数据: type === 'movie' ? {
        douban: ratingData.douban,
        imdb: ratingData.imdb,
        rottenTomatoes: ratingData.rottentomatoes?.series,
        metacritic: ratingData.metacritic?.overall,
        tmdb: ratingData.tmdb,
        trakt: ratingData.trakt,
        letterboxd: ratingData.letterboxd
      } : {
        整剧评分: {
          douban: (effectiveRatingData as TVShowRatingData).douban,
          imdb: (effectiveRatingData as TVShowRatingData).imdb,
          rottenTomatoes: (effectiveRatingData as TVShowRatingData).rottentomatoes?.series,
          metacritic: (effectiveRatingData as TVShowRatingData).metacritic?.overall,
          tmdb: (effectiveRatingData as TVShowRatingData).tmdb,
          trakt: (effectiveRatingData as TVShowRatingData).trakt,
          letterboxd: (effectiveRatingData as TVShowRatingData).letterboxd
        },
        分季评分: {
          douban: (ratingData as TVShowRatingData).douban?.seasons,
          rottenTomatoes: (ratingData as TVShowRatingData).rottentomatoes?.seasons,
          metacritic: (ratingData as TVShowRatingData).metacritic?.seasons,
          tmdb: (ratingData as TVShowRatingData).tmdb?.seasons,
          trakt: (ratingData as TVShowRatingData).trakt?.seasons
        }
      }
    });
  }

  return {
    rating: finalRating,
    validRatings: state.validPlatforms.length,
    platforms: state.validPlatforms
  };
}
