// ==========================================
// 平台链接生成工具
// ==========================================
interface MediaInfo {
  id?: number;
  imdbId?: string;
  title?: string;
  originalTitle?: string;
  enTitle?: string;
  year?: number;
  type?: 'movie' | 'tv';
}

export interface DoubanRatingLike {
  url?: string | null;
  seasons?: Array<{ season_number: number; url?: string | null }>;
}

export const TRAKT_WEB_BASE = 'https://app.trakt.tv';

export function buildTraktUrl(mediaType: 'movie' | 'tv', slug: string): string | null {
  const clean = (slug || '').trim();
  if (!clean || clean === '-' || /^-?\d{4}$/.test(clean)) {
    return null;
  }
  const segment = mediaType === 'tv' ? 'shows' : 'movies';
  return `${TRAKT_WEB_BASE}/${segment}/${clean}`;
}

export function buildTraktShowSeasonUrl(showUrl: string, seasonNumber: number): string {
  if (!showUrl?.trim() || seasonNumber <= 0) {
    return showUrl;
  }

  try {
    const url = new URL(showUrl);
    const showPath = url.pathname.match(/^(\/shows\/[^/]+)/);
    if (showPath) {
      url.pathname = showPath[1];
    }
    url.searchParams.set('season', String(seasonNumber));
    url.searchParams.delete('mode');
    return url.toString();
  } catch {
    const base = showUrl.replace(/\/seasons\/\d+.*$/i, '').split('?')[0].trim();
    return `${base}?season=${seasonNumber}`;
  }
}

export function getDoubanTvAggregatedRatingCardUrl(
  douban: DoubanRatingLike | null | undefined,
  media?: MediaInfo | null
): string | null {
  if (!douban) return media ? getDoubanUrl(media) : null;
  const seasons = Array.isArray(douban.seasons) ? douban.seasons : [];
  if (seasons.length > 1) {
    const sorted = [...seasons].sort((a, b) => a.season_number - b.season_number);
    const first = sorted.find((s) => s.season_number === 1) ?? sorted[0];
    const u = (first?.url && String(first.url).trim()) || '';
    return u || douban.url || (media ? getDoubanUrl(media) : null);
  }
  const s0 = seasons[0];
  return douban.url || (s0?.url && String(s0.url).trim()) || (media ? getDoubanUrl(media) : null);
}

export function getDoubanUrl(media: MediaInfo): string | null {
  if (!media.title && !media.originalTitle) return null;
  const searchTitle = encodeURIComponent(media.title || media.originalTitle || '');
  return `https://search.douban.com/movie/subject_search?search_text=${searchTitle}`;
}

export function getImdbUrl(media: MediaInfo): string | null {
  if (media.imdbId) {
    return `https://www.imdb.com/title/${media.imdbId}/`;
  }
  if (media.title || media.originalTitle) {
    const searchTitle = encodeURIComponent(media.title || media.originalTitle || '');
    return `https://www.imdb.com/find/?q=${searchTitle}`;
  }
  return null;
}

export function getLetterboxdUrl(media: MediaInfo): string | null {
  if (!media.title && !media.originalTitle && !media.imdbId) return null;
  
  if (media.imdbId) {
    return `https://letterboxd.com/imdb/${media.imdbId}/`;
  }
  
  const searchTitle = encodeURIComponent(media.title || media.originalTitle || '');
  return `https://letterboxd.com/search/${searchTitle}/`;
}

export function getRottenTomatoesUrl(media: MediaInfo): string | null {
  if (!media.title && !media.originalTitle) return null;
  
  const searchTitle = encodeURIComponent(media.title || media.originalTitle || '');
  return `https://www.rottentomatoes.com/search?search=${searchTitle}`;
}

export function getMetacriticUrl(media: MediaInfo): string | null {
  if (!media.title && !media.originalTitle) return null;
  
  const searchTitle = encodeURIComponent(media.title || media.originalTitle || '');
  return `https://www.metacritic.com/search/${searchTitle}/`;
}

export function getTmdbUrl(media: MediaInfo): string | null {
  if (!media.id) return null;
  
  const mediaType = media.type === 'tv' ? 'tv' : 'movie';
  return `https://www.themoviedb.org/${mediaType}/${media.id}`;
}

export function getTraktUrl(media: MediaInfo, slug?: string | null): string | null {
  if (slug) {
    return buildTraktUrl(media.type === 'tv' ? 'tv' : 'movie', slug);
  }

  const title = (media.enTitle || media.originalTitle || '').trim();
  if (!title || !/[a-zA-Z]/.test(title)) {
    return null;
  }

  let guessed = title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!guessed) {
    return null;
  }

  if (media.type === 'movie' && media.year) {
    guessed = `${guessed}-${media.year}`;
  }

  return buildTraktUrl(media.type === 'tv' ? 'tv' : 'movie', guessed);
}
