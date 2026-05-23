// ==========================================
// TMDB 聚合请求模块
// ==========================================
import { TMDB } from './api';
import { fetchTMDBWithLanguageFallback } from './tmdbLanguageHelper';
import { transformTMDBMovie, transformTMDBTVShow } from './transformers';
import type { Movie, TVShow } from '../shared/types/media';
import { posterPathToSiteUrl } from './image';
import { getPreferredPosterUrlForMedia } from './preferredPoster';

export async function searchByImdbId(imdbId: string): Promise<{ movies: Movie[], tvShows: TVShow[] }> {
  try {
    const formattedId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
    
    const data = await fetchTMDBWithLanguageFallback(
      `${TMDB.baseUrl}/find/${formattedId}`,
      { external_source: 'imdb_id' }
    );
    
    console.log('TMDB find response:', data);
    
    const movies = await Promise.all(
      (data.movie_results || []).map(async (item: any) => {
        const preferredPoster = await getPreferredPosterUrlForMedia(
          'movie',
          item.id,
          item.poster_path || ''
        );
        return transformTMDBMovie({ ...item, poster_path: preferredPoster || item.poster_path });
      })
    );
    const tvShows = await Promise.all(
      (data.tv_results || []).map(async (item: any) => {
        const preferredPoster = await getPreferredPosterUrlForMedia(
          'tv',
          item.id,
          item.poster_path || ''
        );
        return transformTMDBTVShow({ ...item, poster_path: preferredPoster || item.poster_path });
      })
    );

    return { movies, tvShows };
  } catch (error) {
    console.error('通过IMDB ID搜索失败:', error);
    return { movies: [], tvShows: [] };
  }
}

export async function getMediaDetails(mediaType: string, mediaId: string) {
  const type = mediaType as 'movie' | 'tv';
  const data = await fetchTMDBWithLanguageFallback(
    `${TMDB.baseUrl}/${mediaType}/${mediaId}`
  );

  const posterPath = data.poster_path
    ? await getPreferredPosterUrlForMedia(type, mediaId, data.poster_path, 'w500').then(
        (url) => url || posterPathToSiteUrl(data.poster_path, 'w500')
      )
    : '';
  
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
