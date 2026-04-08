// ==========================================
// 各平台评分数据类型定义
// ==========================================

// 豆瓣评分类型定义
export interface DoubanRating {
  rating: string;
  rating_people: string;
  seasons?: Array<DoubanSeasonRating>;
  url?: string;
}

// IMDb 评分类型定义
export interface IMDBRating {
  rating: string;
  rating_people: string;
  url?: string;
}

export interface LetterboxdRating {
  status: string;
  rating: string;
  rating_count: string;
  url?: string;
}

// Rotten Tomatoes 评分类型定义
export interface RottenTomatoesRating {
  series: {
    tomatometer: string;
    audience_score: string;
    critics_avg: string;
    critics_count: string;
    audience_count: string;
    audience_avg: string;
  };
  seasons: Array<RottenTomatoesSeasonRating>;
  url?: string;
}

// Metacritic 评分类型定义
export interface MetacriticRating {
  overall: {
    metascore: string;
    critics_count: string;
    userscore: string;
    users_count: string;
  };
  seasons: Array<MetacriticSeasonRating>;
  url?: string;
}

// TMDB 评分类型定义
export interface TMDBRating {
  rating: number;
  voteCount: number;
  seasons?: Array<TMDBSeasonRating>;
}

// Trakt 评分类型定义
export interface TraktRating {
  rating: number;
  votes: number;
  distribution?: {
    '1': number;
    '2': number;
    '3': number;
    '4': number;
    '5': number;
    '6': number;
    '7': number;
    '8': number;
    '9': number;
    '10': number;
  };
  seasons?: Array<TraktSeasonRating>;
  url?: string;
}


// 豆瓣季度评分
export interface DoubanSeasonRating {
  season_number: number;
  rating: string;
  rating_people: string;
  url?: string;
}

// Rotten Tomatoes 季度评分
export interface RottenTomatoesSeasonRating {
  season_number: number;
  tomatometer: string;
  audience_score: string;
  critics_avg: string;
  audience_avg: string;
  critics_count: string;
  audience_count: string;
  url?: string;
}

// Metacritic 季度评分
export interface MetacriticSeasonRating {
  season_number: number;
  metascore: string;
  critics_count: string;
  userscore: string;
  users_count: string;
  url?: string;
}

// TMDB 季度评分
export interface TMDBSeasonRating {
  season_number: number;
  rating: number;
  voteCount: number;
}

// Trakt 季度评分
export interface TraktSeasonRating {
  season_number: number;
  rating: number;
  votes: number;
  distribution?: Record<string, number>;
}

export interface MovieRatingData {
  type: 'movie';
  douban: DoubanRating | null;
  imdb: IMDBRating | null;
  letterboxd: LetterboxdRating | null;
  rottentomatoes: RottenTomatoesRating | null;
  metacritic: MetacriticRating | null;
  tmdb: TMDBRating | null;
  trakt: TraktRating | null;
}

export interface TVShowRatingData {
  type: 'tv';
  seasons?: Array<{
    season_number: number;
    douban?: Omit<DoubanSeasonRating, 'season_number'>;
    rottentomatoes?: Omit<RottenTomatoesSeasonRating, 'season_number'>;
    metacritic?: Omit<MetacriticSeasonRating, 'season_number'>;
    tmdb?: Omit<TMDBSeasonRating, 'season_number'>;
    trakt?: Omit<TraktSeasonRating, 'season_number'>;
  }>;
  douban?: DoubanRating;
  imdb?: IMDBRating;
  letterboxd?: LetterboxdRating;
  rottentomatoes?: {
    series?: RottenTomatoesRating['series'];
    seasons?: Array<RottenTomatoesSeasonRating>;
    url?: string;
  };
  metacritic?: {
    overall?: MetacriticRating['overall'];
    seasons?: Array<MetacriticSeasonRating>;
    url?: string;
  };
  tmdb?: TMDBRating;
  trakt?: TraktRating;
}

export interface SeasonRatingData {
  douban?: {
    rating?: string;
    rating_people?: string;
    seasons?: Array<{
      season_number: number;
      rating: string;
      rating_people: string;
    }>;
  };
  rottentomatoes?: {
    tomatometer?: string;
    audience_score?: string;
    critics_avg?: string;
    audience_avg?: string;
    critics_count?: string;
    audience_count?: string;
    seasons?: Array<{
      season_number: number;
      tomatometer: string;
      audience_score: string;
      critics_avg: string;
      audience_avg: string;
      critics_count: string;
      audience_count: string;
    }>;
  };
  metacritic?: {
    metascore?: string;
    userscore?: string;
    critics_count?: string;
    users_count?: string;
    seasons?: Array<{
      season_number: number;
      metascore: string;
      userscore: string;
      critics_count: string;
      users_count: string;
    }>;
  };
  tmdb?: {
    rating?: number;
    voteCount?: number;
    seasons?: Array<{
      season_number: number;
      rating: number;
      voteCount: number;
    }>;
  };
  trakt?: {
    rating?: number;
    votes?: number;
    seasons?: Array<{
      season_number: number;
      rating: number;
      votes: number;
      distribution?: Record<string, number>;
    }>;
  };
}

export function isTVShowRatingData(data: MovieRatingData | TVShowRatingData): data is TVShowRatingData {
  return data.type === 'tv';
}

export type RatingData = MovieRatingData | TVShowRatingData;

export type FetchStatus = 'pending' | 'loading' | 'successful' | 'fail' | 'not_found' | 'no_rating' | 'error' | 'rate_limit' | 'timeout' | 'locked';

export interface PlatformStatus {
  status: FetchStatus;
  data: any;
}

export interface PlatformStatuses {
  [key: string]: PlatformStatus;
}

export interface CalculatedRating {
  rating: number | null;
  validRatings: number;
  platforms: string[];
  hasNewData?: boolean;
}
