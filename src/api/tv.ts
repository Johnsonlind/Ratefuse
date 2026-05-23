// ==========================================
// 剧集领域 API 服务
// ==========================================
import { searchMedia } from './client';
import { transformTMDBTVShow } from './transformers';
import type { TVShow } from '../shared/types/media';
import { fetchTMDBWithLanguageFallback } from './tmdbLanguageHelper';
import { TMDB } from './api';
import { applyPreferredPosterToMediaData, getPreferredPosterUrlForMedia } from './preferredPoster';
import { TMDB_POSTER_FETCH_LANGUAGES } from './tmdbImagePriority';

export async function getTVShow(id: string): Promise<TVShow> {
  const data = await fetchTMDBWithLanguageFallback(
    `${TMDB.baseUrl}/tv/${id}`,
    {
      include_image_language: TMDB_POSTER_FETCH_LANGUAGES,
    },
    'credits,external_ids,images'
  );

  await applyPreferredPosterToMediaData('tv', id, data);

  return transformTMDBTVShow(data, { posterSize: '原始', seasonPosterSize: '原始' });
}

export async function searchTVShows(query: string, page = 1) {
  return searchMedia('tv', query, page, async (item) => {
    const preferredPoster = await getPreferredPosterUrlForMedia('tv', item.id, item.poster_path || '');
    return transformTMDBTVShow({ ...item, poster_path: preferredPoster || item.poster_path });
  });
}
