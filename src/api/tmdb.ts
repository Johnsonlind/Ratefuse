// ==========================================
// TMDB 聚合请求模块
// ==========================================
import { TMDB } from './api';
import { fetchTMDBWithLanguageFallback } from './tmdbLanguageHelper';
import { transformTMDBMovie, transformTMDBTVShow } from './transformers';
import type { Movie, TVShow } from '../shared/types/media';
import { posterPathToSiteUrl } from './image';

export async function searchByImdbId(imdbId: string): Promise<{ movies: Movie[], tvShows: TVShow[] }> {
  try {
    const formattedId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
    
    const data = await fetchTMDBWithLanguageFallback(
      `${TMDB.baseUrl}/find/${formattedId}`,
      { external_source: 'imdb_id' }
    );
    
    console.log('TMDB find response:', data);
    
    return {
      movies: (data.movie_results || []).map(transformTMDBMovie),
      tvShows: (data.tv_results || []).map(transformTMDBTVShow)
    };
  } catch (error) {
    console.error('通过IMDB ID搜索失败:', error);
    return { movies: [], tvShows: [] };
  }
}

export async function getMediaDetails(mediaType: string, mediaId: string) {
  const data = await fetchTMDBWithLanguageFallback(
    `${TMDB.baseUrl}/${mediaType}/${mediaId}`
  );
  
  let posterPath = '';
  if (data.poster_path) {
    posterPath = posterPathToSiteUrl(data.poster_path, 'w500');
  }
  
  return {
    media_id: mediaId,
    media_type: mediaType,
    title: mediaType === 'movie' ? data.title : data.name,
    poster: posterPath,
    year: mediaType === 'movie' ? 
      data.release_date?.split('-')[0] : 
      data.first_air_date?.split('-')[0],
    overview: data.overview || '暂无简介'
  };
}
