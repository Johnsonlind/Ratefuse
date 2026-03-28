// ==========================================
// 电影领域 API 服务
// ==========================================
import { searchMedia } from './client';
import { transformTMDBMovie } from './transformers';
import type { Movie } from '../shared/types/media';
import { fetchTMDBWithLanguageFallback } from './tmdbLanguageHelper';

export async function getMovie(id: string): Promise<Movie> {
  const data = await fetchTMDBWithLanguageFallback(
    `/api/tmdb-proxy/movie/${id}`,
    {},
    'credits,release_dates'
  );
  
  return transformTMDBMovie(data, { posterSize: '原始' });
}

export async function searchMovies(query: string, page = 1) {
  return searchMedia('movie', query, page, transformTMDBMovie);
}
