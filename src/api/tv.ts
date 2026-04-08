// ==========================================
// 剧集领域 API 服务
// ==========================================
import { searchMedia } from './client';
import { transformTMDBTVShow } from './transformers';
import type { TVShow } from '../shared/types/media';
import { fetchTMDBWithLanguageFallback } from './tmdbLanguageHelper';
import { TMDB } from './api';

export async function getTVShow(id: string): Promise<TVShow> {
  const data = await fetchTMDBWithLanguageFallback(
    `${TMDB.baseUrl}/tv/${id}`,
    {},
    'credits,external_ids'
  );
  
  return transformTMDBTVShow(data, { posterSize: '原始', seasonPosterSize: '原始' });
}

export async function searchTVShows(query: string, page = 1) {
  return searchMedia('tv', query, page, transformTMDBTVShow);
}
