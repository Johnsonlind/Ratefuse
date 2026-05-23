// ==========================================
// 管理端检索 API 模块
// ==========================================
import { buildTmdbApiUrl } from './api';
import { calendarYearFromIsoDate } from '../shared/utils/time';
import { resolveStandardPosterSiteUrl } from './preferredPoster';

export interface AdminMediaItem {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  poster: string;
  year?: number;
}

export interface AdminSearchResult {
  movies: { results: AdminMediaItem[] };
  tvShows: { results: AdminMediaItem[] };
}

const ADMIN_POSTER_SIZE = 'w185';

async function toAdminPoster(
  type: 'movie' | 'tv',
  id: number,
  posterPath: string | null | undefined
): Promise<string> {
  return resolveStandardPosterSiteUrl(type, id, posterPath, ADMIN_POSTER_SIZE);
}

async function mapMovieResults(results: any[]): Promise<AdminMediaItem[]> {
  return Promise.all(
    results.slice(0, 12).map(async (r) => ({
      id: r.id,
      type: 'movie' as const,
      title: r.title || '',
      poster: await toAdminPoster('movie', r.id, r.poster_path),
      year: calendarYearFromIsoDate(r.release_date),
    }))
  );
}

async function mapTvResults(results: any[]): Promise<AdminMediaItem[]> {
  return Promise.all(
    results.slice(0, 12).map(async (r) => ({
      id: r.id,
      type: 'tv' as const,
      title: r.name || '',
      poster: await toAdminPoster('tv', r.id, r.poster_path),
      year: calendarYearFromIsoDate(r.first_air_date),
    }))
  );
}

function parseSearchQuery(query: string): {
  searchTerm: string;
  year?: number;
  language?: string;
} {
  const yearMatch = query.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : undefined;
  let searchTerm = query.replace(/\b(19|20)\d{2}\b/, '').trim();

  let language: string | undefined;
  if (/[\u4e00-\u9fa5]/.test(searchTerm)) {
    language = 'zh-CN';
  } else if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(searchTerm)) {
    language = 'ja-JP';
  } else if (/[\uac00-\ud7af]/.test(searchTerm)) {
    language = 'ko-KR';
  } else {
    language = 'zh-CN';
  }
  return { searchTerm, year, language };
}

export async function adminSearchMedia(q: string): Promise<AdminSearchResult> {
  const trimmed = (q || '').trim();
  if (!trimmed) {
    return { movies: { results: [] }, tvShows: { results: [] } };
  }

  const imdbMatch = trimmed.match(/^(?:tt)?(\d{7,8})$/);
  if (imdbMatch) {
    try {
      const formattedId = imdbMatch[0].startsWith('tt') ? imdbMatch[0] : `tt${imdbMatch[0]}`;
      const res = await fetch(
        buildTmdbApiUrl(`find/${formattedId}`, { external_source: 'imdb_id' })
      );
      const data = await res.json();
      const movies = await mapMovieResults(data.movie_results || []);
      const tvs = await mapTvResults(data.tv_results || []);
      return { movies: { results: movies }, tvShows: { results: tvs } };
    } catch {
      return { movies: { results: [] }, tvShows: { results: [] } };
    }
  }

  const tmdbIdMatch = trimmed.match(/^(\d+)$/);
  if (tmdbIdMatch) {
    const id = tmdbIdMatch[1];
    try {
      const [movieRes, tvRes] = await Promise.all([
        fetch(buildTmdbApiUrl(`movie/${id}`, { language: 'zh-CN' })),
        fetch(buildTmdbApiUrl(`tv/${id}`, { language: 'zh-CN' })),
      ]);
      const results: AdminMediaItem[] = [];
      if (movieRes.ok) {
        const m = await movieRes.json();
        if (!m.status_code) {
          results.push({
            id: m.id,
            type: 'movie',
            title: m.title || '',
            poster: await toAdminPoster('movie', m.id, m.poster_path),
            year: calendarYearFromIsoDate(m.release_date),
          });
        }
      }
      if (tvRes.ok) {
        const t = await tvRes.json();
        if (!t.status_code) {
          results.push({
            id: t.id,
            type: 'tv',
            title: t.name || '',
            poster: await toAdminPoster('tv', t.id, t.poster_path),
            year: calendarYearFromIsoDate(t.first_air_date),
          });
        }
      }
      const movies = results.filter((r) => r.type === 'movie');
      const tvs = results.filter((r) => r.type === 'tv');
      return { movies: { results: movies }, tvShows: { results: tvs } };
    } catch {
    }
  }

  const { searchTerm, year, language } = parseSearchQuery(trimmed);
  if (!searchTerm) {
    return { movies: { results: [] }, tvShows: { results: [] } };
  }

  const lang = language || 'zh-CN';

  try {
    if (year) {
      const [movieRes, tvRes] = await Promise.all([
        fetch(
          buildTmdbApiUrl('search/movie', {
            query: searchTerm,
            language: lang,
            year: String(year),
            include_adult: 'false',
          })
        ),
        fetch(
          buildTmdbApiUrl('search/tv', {
            query: searchTerm,
            language: lang,
            first_air_date_year: String(year),
            include_adult: 'false',
          })
        ),
      ]);
      const movieData = movieRes.ok ? await movieRes.json() : { results: [] };
      const tvData = tvRes.ok ? await tvRes.json() : { results: [] };
      const movies = await mapMovieResults(movieData.results || []);
      const tvs = await mapTvResults(tvData.results || []);
      return { movies: { results: movies }, tvShows: { results: tvs } };
    }

    const res = await fetch(
      buildTmdbApiUrl('search/multi', { query: searchTerm, language: lang })
    );
    const data = await res.json();
    const rawResults = data.results || [];

    const movies = await mapMovieResults(
      rawResults.filter((r: any) => r.media_type === 'movie')
    );
    const tvs = await mapTvResults(
      rawResults.filter((r: any) => r.media_type === 'tv')
    );

    return { movies: { results: movies }, tvShows: { results: tvs } };
  } catch {
    return { movies: { results: [] }, tvShows: { results: [] } };
  }
}
