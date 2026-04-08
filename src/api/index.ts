// ==========================================
// API 聚合入口
// ==========================================
import { searchMovies } from './movies';
import { searchTVShows } from './tv';
import { searchByImdbId } from './tmdb';

export { getMovie } from './movies';
export { getTVShow } from './tv';

interface SearchParams {
  page?: number;
}

export async function searchMedia(
  query: string,
  { page = 1 }: SearchParams = {}
) {
  const imdbIdMatch = query.match(/^(?:tt)?(\d{7,8})$/);
  
  if (imdbIdMatch) {
    const results = await searchByImdbId(imdbIdMatch[0]);
    return {
      movies: { 
        results: results.movies,
        totalPages: 1,
        totalResults: results.movies.length
      },
      tvShows: {
        results: results.tvShows,
        totalPages: 1,
        totalResults: results.tvShows.length
      }
    };
  }
  
  const [movies, tvShows] = await Promise.all([
    searchMovies(query, page),
    searchTVShows(query, page),
  ]);

  return { movies, tvShows };
}
