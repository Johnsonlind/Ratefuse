// ==========================================
// 电影领域 API 服务
// ==========================================
import { searchMedia } from './client';
import { transformTMDBMovie } from './transformers';
import type { Movie } from '../shared/types/media';
import { fetchTMDBWithLanguageFallback } from './tmdbLanguageHelper';
import { TMDB } from './api';
import { getPreferredPosterUrlForMedia } from './preferredPoster';

export async function getMovie(id: string): Promise<Movie> {
  const data = await fetchTMDBWithLanguageFallback(
    `${TMDB.baseUrl}/movie/${id}`,
    {
      include_image_language: 'zh-CN,zh-SG,zh-TW,zh-HK,en,null',
    },
    'credits,release_dates,images'
  );
  
  return transformTMDBMovie(data, { posterSize: '原始' });
}

export async function searchMovies(query: string, page = 1) {
  return searchMedia('movie', query, page, async (item) => {
    const preferredPoster = await getPreferredPosterUrlForMedia('movie', item.id, item.poster_path || '');
    return transformTMDBMovie({ ...item, poster_path: preferredPoster || item.poster_path });
  });
}
