// ==========================================
// 通用搜索/HTTP 客户端
// ==========================================
import axios from 'axios';
import { getPrimaryLanguage } from './tmdbLanguageHelper';
import { TMDB } from './api';

export const tmdbClient = axios.create({
  baseURL: TMDB.baseUrl,
});

tmdbClient.interceptors.request.use((config) => {
  const key = import.meta.env.VITE_TMDB_API_KEY as string | undefined;
  config.params = { ...(config.params || {}), ...(key ? { api_key: key } : {}) };
  return config;
});

export function parseSearchQuery(query: string): {
  searchTerm: string;
  year?: number;
  language?: string;
} {
  const yearMatch = query.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : undefined;
  
  let searchTerm = query.replace(/\b(19|20)\d{2}\b/, '').trim();
  
  let language = undefined;
  if (/[\u4e00-\u9fa5]/.test(searchTerm)) {
    language = 'zh-CN';
  } else if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(searchTerm)) {
    language = 'ja-JP';
  } else if (/[\uac00-\ud7af]/.test(searchTerm)) {
    language = 'ko-KR';
  }
  
  return { searchTerm, year, language };
}

/**
 * 通用媒体搜索函数
 * @param mediaType 媒体类型：'movie' 或 'tv'
 * @param query 搜索查询字符串
 * @param page 页码
 * @param transformFn 数据转换函数
 * @returns 搜索结果
 */
export async function searchMedia<T>(
  mediaType: 'movie' | 'tv',
  query: string,
  page: number,
  transformFn: (item: any) => T | Promise<T>
) {
  const { searchTerm, year, language } = parseSearchQuery(query);
  
  const response = await tmdbClient.get(`/search/${mediaType}`, {
    params: {
      query: searchTerm,
      page,
      include_adult: false,
      language: language || getPrimaryLanguage(),
      ...(mediaType === 'movie' ? { year } : { first_air_date_year: year }),
    },
  });

  return {
    results: await Promise.all(response.data.results.map(transformFn)),
    totalPages: response.data.total_pages,
    totalResults: response.data.total_results,
  };
}
