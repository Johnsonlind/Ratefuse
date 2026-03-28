// ==========================================
// 外部平台 API 基础配置
// ==========================================
import { getPrimaryLanguage } from './tmdbLanguageHelper';

const env = import.meta.env;

const DEFAULT_TMDB_API_BASE = 'https://tmdb.ratefuse.cn/3';

export const TMDB = {
  baseUrl: String(env.VITE_TMDB_BASE_URL || DEFAULT_TMDB_API_BASE).replace(/\/$/, ''),
  imageOrigin: 'https://tmdb.ratefuse.cn',
  imageBaseUrl: '/tmdb-images',
  posterSizes: {
    小: 'w185',
    列表: 'w500',
    中: 'w500',
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

export function buildTmdbApiUrl(path: string, params?: Record<string, string>): string {
  const u = new URL(`${TMDB.baseUrl}/${path.replace(/^\//, '')}`);
  const key = env.VITE_TMDB_API_KEY as string | undefined;
  if (key) u.searchParams.set('api_key', key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') u.searchParams.set(k, v);
    }
  }
  return u.toString();
}
