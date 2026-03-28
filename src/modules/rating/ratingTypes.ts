// ==========================================
// 评分计算中间类型定义
// ==========================================
export interface NormalizedRating {
  platform: 'douban' | 'imdb' | 'rt' | 'mc' | 'tmdb' | 'trakt' | 'letterboxd';
  type: 'critic' | 'user';
  score: number;
  voteCount?: number;
  platformLabel?: string;
  season?: number;
}

export interface RatingContribution {
  rating: NormalizedRating;
  effectiveVotes: number;
  platformWeight: number;
  typeWeight: number;
  contribution: number;
  weightedVotes: number;
}

export interface SeparatedCalculationState {
  criticContributions: RatingContribution[];
  userContributions: RatingContribution[];
  criticSum: number;
  criticWeightSum: number;
  userSum: number;
  userWeightSum: number;
}
