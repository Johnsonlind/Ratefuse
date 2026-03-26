// ==========================================
// 评分处理与总分计算工具
// ==========================================
import { isValidRatingData, normalizeRating, safeParseCount } from './ratingHelpers';
import type { NormalizedRating } from './ratingTypes';
import { calculateRobustRating } from './robustRatingCalculator';

interface PlatformRatingResult {
  rating: number;
  voteCount: number;
  platform: string;
  originalRating: any;
  normalizedRating: number;
  contribution: number;
  season?: number;
}

interface RatingCalculationState {
  ratingTimesVoteSum: number;
  totalVoteCount: number;
  validPlatforms: string[];
  ratingDetails: any[];
  normalizedRatings: NormalizedRating[];
}

function determineRatingType(platformLabel: string): 'critic' | 'user' {
  if (platformLabel.includes('critics') || 
      platformLabel.includes('metascore') || 
      platformLabel.includes('tomatometer')) {
    return 'critic';
  }
  return 'user';
}

function mapPlatformName(platformName: string): NormalizedRating['platform'] {
  if (platformName === 'rottentomatoes') return 'rt';
  if (platformName === 'metacritic') return 'mc';
  return platformName as NormalizedRating['platform'];
}

function processPlatformRating(
  ratingData: any,
  platformConfig: {
    name: string;
    getRating: (data: any) => any;
    getVoteCount: (data: any) => any;
    normalizeType?: string;
    useDirectParse?: boolean;
    season?: number;
    platformLabel?: string;
  },
  medianVoteCount: number,
  state: RatingCalculationState
): PlatformRatingResult | null {
  const ratingValue = platformConfig.getRating(ratingData);
  
  if (!isValidRatingData(ratingValue)) {
    return null;
  }

  let normalizedRating: number;
  if (platformConfig.useDirectParse) {
    normalizedRating = parseFloat(String(ratingValue || '0'));
  } else {
    normalizedRating = normalizeRating(
      ratingValue,
      platformConfig.name,
      platformConfig.normalizeType || 'default'
    ) ?? 0;
  }

  const voteCountValue = platformConfig.getVoteCount(ratingData);
  const voteCount = voteCountValue !== undefined && voteCountValue !== null
    ? safeParseCount(voteCountValue, medianVoteCount)
    : medianVoteCount;

  const contribution = normalizedRating * voteCount;
  state.ratingTimesVoteSum += contribution;
  state.totalVoteCount += voteCount;

  if (!state.validPlatforms.includes(platformConfig.name)) {
    state.validPlatforms.push(platformConfig.name);
  }

  const platformLabel = platformConfig.platformLabel || platformConfig.name;
  
  const normalizedRatingData: NormalizedRating = {
    platform: mapPlatformName(platformConfig.name),
    type: determineRatingType(platformLabel),
    score: normalizedRating,
    voteCount: voteCountValue !== undefined && voteCountValue !== null 
      ? safeParseCount(voteCountValue, 0) 
      : undefined,
    platformLabel,
    ...(platformConfig.season !== undefined && { season: platformConfig.season })
  };

  state.normalizedRatings.push(normalizedRatingData);

  const result: PlatformRatingResult = {
    rating: normalizedRating,
    voteCount,
    platform: platformLabel,
    originalRating: ratingValue,
    normalizedRating,
    contribution,
    ...(platformConfig.season !== undefined && { season: platformConfig.season })
  };

  state.ratingDetails.push(result);
  return result;
}

export function processDoubanRating(
  ratingData: any,
  medianVoteCount: number,
  state: RatingCalculationState,
  season?: number
): void {
  const getRating = season !== undefined
    ? (data: any) => {
        const seasonDataFromDouban = data.douban?.seasons?.find(
          (s: any) => s.season_number === season
        );
        if (seasonDataFromDouban?.rating) {
          return seasonDataFromDouban.rating;
        }

        if (data.type === 'tv' && Array.isArray(data.seasons)) {
          const seasonEntry = data.seasons.find(
            (s: any) => s.season_number === season && s.douban
          );
          if (seasonEntry?.douban?.rating) {
            return seasonEntry.douban.rating;
          }
        }

        if (
          season === 1 &&
          data.douban?.rating &&
          !data.douban?.seasons &&
          !(data.type === 'tv' && Array.isArray(data.seasons))
        ) {
          return data.douban.rating;
        }

        return undefined;
      }
    : (data: any) => data.douban?.rating;

  const getVoteCount = season !== undefined
    ? (data: any) => {
        const seasonDataFromDouban = data.douban?.seasons?.find(
          (s: any) => s.season_number === season
        );
        if (seasonDataFromDouban?.rating_people) {
          return seasonDataFromDouban.rating_people;
        }

        if (data.type === 'tv' && Array.isArray(data.seasons)) {
          const seasonEntry = data.seasons.find(
            (s: any) => s.season_number === season && s.douban
          );
          if (seasonEntry?.douban?.rating_people) {
            return seasonEntry.douban.rating_people;
          }
        }

        if (
          season === 1 &&
          data.douban?.rating_people &&
          !data.douban?.seasons &&
          !(data.type === 'tv' && Array.isArray(data.seasons))
        ) {
          return data.douban.rating_people;
        }

        return undefined;
      }
    : (data: any) => data.douban?.rating_people;

  processPlatformRating(
    ratingData,
    {
      name: 'douban',
      getRating,
      getVoteCount,
      useDirectParse: true,
      season
    },
    medianVoteCount,
    state
  );
}

export function processIMDBRating(
  ratingData: any,
  medianVoteCount: number,
  state: RatingCalculationState
): void {
  processPlatformRating(
    ratingData,
    {
      name: 'imdb',
      getRating: (data) => data.imdb?.rating,
      getVoteCount: (data) => data.imdb?.rating_people
    },
    medianVoteCount,
    state
  );
}

export function processRottenTomatoesRating(
  ratingData: any,
  medianVoteCount: number,
  state: RatingCalculationState,
  season?: number
): void {
  const rtData = season !== undefined
    ? ratingData.rottentomatoes?.seasons?.find((s: any) => s.season_number === season)
    : ratingData.rottentomatoes?.series;

  if (!rtData) return;

  if (isValidRatingData(rtData.critics_avg)) {
    processPlatformRating(
      { rottentomatoes: { current: rtData } },
      {
        name: 'rottentomatoes',
        platformLabel: 'rottentomatoes_critics',
        getRating: () => rtData.critics_avg,
        getVoteCount: () => rtData.critics_count,
        season
      },
      medianVoteCount,
      state
    );
  } else if (isValidRatingData(rtData.tomatometer)) {
    processPlatformRating(
      { rottentomatoes: { current: rtData } },
      {
        name: 'rottentomatoes',
        platformLabel: season !== undefined ? 'rottentomatoes_tomatometer' : 'rottentomatoes_critics',
        getRating: () => rtData.tomatometer,
        getVoteCount: () => rtData.critics_count,
        normalizeType: 'percentage',
        season
      },
      medianVoteCount,
      state
    );
  }

  if (isValidRatingData(rtData.audience_avg)) {
    processPlatformRating(
      { rottentomatoes: { current: rtData } },
      {
        name: 'rottentomatoes',
        platformLabel: 'rottentomatoes_audience',
        getRating: () => rtData.audience_avg,
        getVoteCount: () => rtData.audience_count,
        normalizeType: 'audience_avg',
        season
      },
      medianVoteCount,
      state
    );
  } else if (isValidRatingData(rtData.audience_score)) {
    processPlatformRating(
      { rottentomatoes: { current: rtData } },
      {
        name: 'rottentomatoes',
        platformLabel: season !== undefined ? 'rottentomatoes_audience_score' : 'rottentomatoes_audience',
        getRating: () => rtData.audience_score,
        getVoteCount: () => rtData.audience_count,
        normalizeType: 'percentage',
        season
      },
      medianVoteCount,
      state
    );
  }
}

export function processMetacriticRating(
  ratingData: any,
  medianVoteCount: number,
  state: RatingCalculationState,
  season?: number
): void {
  const mcData = season !== undefined
    ? ratingData.metacritic?.seasons?.find((s: any) => s.season_number === season)
    : ratingData.metacritic?.overall;

  if (!mcData) return;

  if (isValidRatingData(mcData.metascore)) {
    processPlatformRating(
      { metacritic: { current: mcData } },
      {
        name: 'metacritic',
        platformLabel: 'metacritic_critics',
        getRating: () => mcData.metascore,
        getVoteCount: () => mcData.critics_count,
        normalizeType: 'metascore',
        season
      },
      medianVoteCount,
      state
    );
  }

  if (isValidRatingData(mcData.userscore)) {
    processPlatformRating(
      { metacritic: { current: mcData } },
      {
        name: 'metacritic',
        platformLabel: season !== undefined ? 'metacritic_userscore' : 'metacritic_users',
        getRating: () => mcData.userscore,
        getVoteCount: () => mcData.users_count,
        normalizeType: 'userscore',
        season
      },
      medianVoteCount,
      state
    );
  }
}

export function processTMDBRating(
  ratingData: any,
  medianVoteCount: number,
  state: RatingCalculationState,
  season?: number
): void {
  if (season !== undefined) {
    const seasonData = ratingData.tmdb?.seasons?.find((s: any) => s.season_number === season);
    if (isValidRatingData(seasonData?.rating)) {
      processPlatformRating(
        ratingData,
        {
          name: 'tmdb',
          getRating: () => seasonData.rating,
          getVoteCount: () => seasonData.voteCount,
          season
        },
        medianVoteCount,
        state
      );
    }
  } else {
    processPlatformRating(
      ratingData,
      {
        name: 'tmdb',
        getRating: (data) => data.tmdb?.rating,
        getVoteCount: (data) => data.tmdb?.voteCount
      },
      medianVoteCount,
      state
    );
  }
}

export function processTraktRating(
  ratingData: any,
  medianVoteCount: number,
  state: RatingCalculationState,
  season?: number
): void {
  if (season !== undefined) {
    const seasonData = ratingData.trakt?.seasons?.find((s: any) => s.season_number === season);
    if (isValidRatingData(seasonData?.rating)) {
      processPlatformRating(
        ratingData,
        {
          name: 'trakt',
          getRating: () => seasonData.rating,
          getVoteCount: () => seasonData.votes,
          season
        },
        medianVoteCount,
        state
      );
    }
  } else {
    processPlatformRating(
      ratingData,
      {
        name: 'trakt',
        getRating: (data) => data.trakt?.rating,
        getVoteCount: (data) => data.trakt?.votes
      },
      medianVoteCount,
      state
    );
  }
}

export function processLetterboxdRating(
  ratingData: any,
  medianVoteCount: number,
  state: RatingCalculationState
): void {
  processPlatformRating(
    ratingData,
    {
      name: 'letterboxd',
      getRating: (data) => data.letterboxd?.rating,
      getVoteCount: (data) => data.letterboxd?.rating_count
    },
    medianVoteCount,
    state
  );
}

export function calculateFinalRating(state: RatingCalculationState): number | null {
  if (state.normalizedRatings.length === 0) {
    return null;
  }

  const { finalScore, state: calculationState } = calculateRobustRating(state.normalizedRatings);

  if (process.env.NODE_ENV === 'development') {
    console.log('稳健算法计算详情:', {
      输入评分数: state.normalizedRatings.length,
      专业评分数: calculationState.criticContributions.length,
      用户评分数: calculationState.userContributions.length,
      专业评分汇总: calculationState.criticSum,
      专业权重汇总: calculationState.criticWeightSum,
      用户评分汇总: calculationState.userSum,
      用户权重汇总: calculationState.userWeightSum,
      最终评分: finalScore,
      评分详情: state.normalizedRatings
    });
  }

  return finalScore;
}

export function createRatingCalculationState(): RatingCalculationState {
  return {
    ratingTimesVoteSum: 0,
    totalVoteCount: 0,
    validPlatforms: [],
    ratingDetails: [],
    normalizedRatings: []
  };
}
