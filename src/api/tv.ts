// ==========================================
// 剧集领域 API 服务
// ==========================================
import { searchMedia } from './client';
import { transformTMDBTVShow } from './transformers';
import type { TVShow } from '../shared/types/media';
import { fetchTMDBWithLanguageFallback } from './tmdbLanguageHelper';
import { TMDB } from './api';
import { getPreferredPosterUrlForMedia } from './preferredPoster';

export async function getTVShow(id: string): Promise<TVShow> {
  const data = await fetchTMDBWithLanguageFallback(
    `${TMDB.baseUrl}/tv/${id}`,
    {
      include_image_language: 'zh-CN,zh-SG,zh-TW,zh-HK,en,null',
    },
    'credits,external_ids,images'
  );
  
  return transformTMDBTVShow(data, { posterSize: '原始', seasonPosterSize: '原始' });
}

export async function searchTVShows(query: string, page = 1) {
  return searchMedia('tv', query, page, async (item) => {
    const preferredPoster = await getPreferredPosterUrlForMedia('tv', item.id, item.poster_path || '');
    return transformTMDBTVShow({ ...item, poster_path: preferredPoster || item.poster_path });
  });
}
