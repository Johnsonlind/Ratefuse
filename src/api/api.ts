// ==========================================
// 外部平台 API 基础配置
// ==========================================
import { getPrimaryLanguage } from './tmdbLanguageHelper';

const env = import.meta.env;

export const TMDB = {
  baseUrl: env.VITE_TMDB_BASE_URL,
  imageBaseUrl: '/tmdb-images',
  posterSizes: {
    小: 'w185',
    列表: 'w300',
    中: 'w342',
    大: 'w500',
    原始: 'original'
  } as const,
  get language() {
    return getPrimaryLanguage();
  },
  findEndpoint: '/find'
} as const;

export const TRAKT = {
  clientId: env.VITE_TRAKT_CLIENT_ID,
  clientSecret: env.VITE_TRAKT_CLIENT_SECRET,
  baseUrl: env.VITE_TRAKT_BASE_URL,
} as const;
