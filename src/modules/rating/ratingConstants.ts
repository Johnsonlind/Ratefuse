// ==========================================
// 评分计算中间类型定义
// ==========================================
export const PLATFORM_WEIGHT = {
  douban: 1.1,
  imdb: 1.1,
  rt: {
    critic: 1.2,
    user: 0.9
  },
  mc: {
    critic: 1.2,
    user: 0.9
  },
  tmdb: 0.8,
  trakt: 0.8,
  letterboxd: 0.9
} as const;

export const TYPE_WEIGHT = {
  critic: 1.1,
  user: 1.0
} as const;

export const FINAL_CRITIC_RATIO = 0.4;
export const FINAL_USER_RATIO = 0.6;

export const MISSING_VOTE_COUNT_PENALTY = 0.7;

export const DEFAULT_FALLBACK_VOTES = 1000;
