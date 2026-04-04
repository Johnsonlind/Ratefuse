// ==========================================
// 鲁棒评分核心算法模块
// ==========================================
import type { NormalizedRating, RatingContribution, SeparatedCalculationState } from './ratingTypes';
import { 
  PLATFORM_WEIGHT, 
  TYPE_WEIGHT, 
  FINAL_CRITIC_RATIO, 
  FINAL_USER_RATIO,
  MISSING_VOTE_COUNT_PENALTY,
  DEFAULT_FALLBACK_VOTES
} from './ratingConstants';

export function calculateEffectiveVotes(voteCount: number): number {
  return Math.log10(voteCount + 1);
}

export function calculateFallbackVotes(ratings: NormalizedRating[]): number {
  const validVoteCounts = ratings
    .filter(r => r.voteCount !== undefined && r.voteCount > 0)
    .map(r => calculateEffectiveVotes(r.voteCount!));

  if (validVoteCounts.length === 0) {
    return calculateEffectiveVotes(DEFAULT_FALLBACK_VOTES);
  }

  validVoteCounts.sort((a, b) => a - b);
  const mid = Math.floor(validVoteCounts.length / 2);
  
  if (validVoteCounts.length % 2 === 0) {
    return (validVoteCounts[mid - 1] + validVoteCounts[mid]) / 2;
  } else {
    return validVoteCounts[mid];
  }
}

export function getPlatformWeight(rating: NormalizedRating): number {
  const platform = rating.platform;
  
  switch (platform) {
    case 'douban':
      return PLATFORM_WEIGHT.douban;
    case 'imdb':
      return PLATFORM_WEIGHT.imdb;
    case 'rt':
      return rating.type === 'critic' ? PLATFORM_WEIGHT.rt.critic : PLATFORM_WEIGHT.rt.user;
    case 'mc':
      return rating.type === 'critic' ? PLATFORM_WEIGHT.mc.critic : PLATFORM_WEIGHT.mc.user;
    case 'tmdb':
      return PLATFORM_WEIGHT.tmdb;
    case 'trakt':
      return PLATFORM_WEIGHT.trakt;
    case 'letterboxd':
      return PLATFORM_WEIGHT.letterboxd;
    default:
      return 1.0;
  }
}

export function getTypeWeight(type: 'critic' | 'user'): number {
  return TYPE_WEIGHT[type];
}

export function calculateRatingContribution(
  rating: NormalizedRating,
  fallbackVotes: number
): RatingContribution {
  let effectiveVotes: number;
  
  if (rating.voteCount !== undefined && rating.voteCount > 0) {
    effectiveVotes = calculateEffectiveVotes(rating.voteCount);
  } else {
    effectiveVotes = fallbackVotes * MISSING_VOTE_COUNT_PENALTY;
  }

  const platformWeight = getPlatformWeight(rating);
  const typeWeight = getTypeWeight(rating.type);

  const weightedVotes = effectiveVotes * platformWeight * typeWeight;

  const contribution = rating.score * weightedVotes;

  return {
    rating,
    effectiveVotes,
    platformWeight,
    typeWeight,
    contribution,
    weightedVotes
  };
}

export function separateAndCalculate(ratings: NormalizedRating[]): SeparatedCalculationState {
  if (ratings.length === 0) {
    return {
      criticContributions: [],
      userContributions: [],
      criticSum: 0,
      criticWeightSum: 0,
      userSum: 0,
      userWeightSum: 0
    };
  }

  const fallbackVotes = calculateFallbackVotes(ratings);

  const contributions = ratings.map(rating => 
    calculateRatingContribution(rating, fallbackVotes)
  );

  const criticContributions = contributions.filter(c => c.rating.type === 'critic');
  const userContributions = contributions.filter(c => c.rating.type === 'user');

  const criticSum = criticContributions.reduce((sum, c) => sum + c.contribution, 0);
  const criticWeightSum = criticContributions.reduce((sum, c) => sum + c.weightedVotes, 0);

  const userSum = userContributions.reduce((sum, c) => sum + c.contribution, 0);
  const userWeightSum = userContributions.reduce((sum, c) => sum + c.weightedVotes, 0);

  return {
    criticContributions,
    userContributions,
    criticSum,
    criticWeightSum,
    userSum,
    userWeightSum
  };
}

export function calculateFinalScore(state: SeparatedCalculationState): number | null {
  const { criticSum, criticWeightSum, userSum, userWeightSum } = state;

  if (criticWeightSum === 0 && userWeightSum === 0) {
    return null;
  }

  const criticScore = criticWeightSum > 0 ? criticSum / criticWeightSum : 0;
  const userScore = userWeightSum > 0 ? userSum / userWeightSum : 0;

  let finalScore: number;

  if (criticWeightSum > 0 && userWeightSum > 0) {
    finalScore = criticScore * FINAL_CRITIC_RATIO + userScore * FINAL_USER_RATIO;
  } else if (criticWeightSum > 0) {
    finalScore = criticScore;
  } else {
    finalScore = userScore;
  }

  return Math.round(finalScore * 10) / 10;
}

export function calculateRobustRating(ratings: NormalizedRating[]): {
  finalScore: number | null;
  state: SeparatedCalculationState;
} {
  const state = separateAndCalculate(ratings);
  const finalScore = calculateFinalScore(state);

  return {
    finalScore,
    state
  };
}
