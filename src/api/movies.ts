// ==========================================
// 电影领域 API 服务
// ==========================================
import { searchMedia } from './client';
import { transformTMDBMovie } from './transformers';
import type { Movie } from '../shared/types/media';
import { fetchTMDBWithLanguageFallback } from './tmdbLanguageHelper';
import { TMDB } from './api';
import { applyPreferredPosterToMediaData, getPreferredPosterUrlForMedia } from './preferredPoster';
import { TMDB_POSTER_FETCH_LANGUAGES } from './tmdbImagePriority';

export async function getMovie(id: string): Promise<Movie> {
  const data = await fetchTMDBWithLanguageFallback(
    `${TMDB.baseUrl}/movie/${id}`,
    {
      include_image_language: TMDB_POSTER_FETCH_LANGUAGES,
    },
    'credits,release_dates,images'
  );

  await applyPreferredPosterToMediaData('movie', id, data);

  return transformTMDBMovie(data, { posterSize: '原始' });
}

export async function searchMovies(query: string, page = 1) {
  return searchMedia('movie', query, page, async (item) => {
    const preferredPoster = await getPreferredPosterUrlForMedia('movie', item.id, item.poster_path || '');
    return transformTMDBMovie({ ...item, poster_path: preferredPoster || item.poster_path });
  });
}
