// ==========================================
// 首选海报 URL 获取工具
// ==========================================
import { buildTmdbApiUrl } from './api';
import { posterPathToSiteUrl } from './image';
import { pickPreferredTmdbImagePath } from './tmdbImagePriority';

type MediaType = 'movie' | 'tv';

type TmdbPoster = {
  file_path?: string;
  iso_639_1?: string | null;
  iso_3166_1?: string | null;
};

const posterPromiseCache = new Map<string, Promise<string>>();
const TMDB_FETCH_CONCURRENCY = 50;
let tmdbInFlight = 0;
const tmdbQueue: Array<() => void> = [];

async function runWithTmdbFetchQueue<T>(task: () => Promise<T>): Promise<T> {
  if (tmdbInFlight >= TMDB_FETCH_CONCURRENCY) {
    await new Promise<void>((resolve) => tmdbQueue.push(resolve));
  }
  tmdbInFlight += 1;
  try {
    return await task();
  } finally {
    tmdbInFlight -= 1;
    const next = tmdbQueue.shift();
    if (next) next();
  }
}

async function fetchJsonWithRetry(url: string, attempts = 5): Promise<any | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await runWithTmdbFetchQueue(() => fetch(url));
      if (response.ok) return await response.json();

      const canRetry = response.status === 429 || response.status >= 500;
      if (!canRetry || attempt === attempts) return null;
    } catch {
      if (attempt === attempts) return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  return null;
}

function pickPreferredPosterPath(
  posters: TmdbPoster[],
  originalLanguage: string | null | undefined
): string | undefined {
  return pickPreferredTmdbImagePath(posters, originalLanguage);
}

export async function getPreferredPosterUrlForMedia(
  mediaType: MediaType,
  mediaId: string | number,
  fallbackPoster: string,
  size: string = 'w500'
): Promise<string> {
  const fallbackUrl = fallbackPoster ? posterPathToSiteUrl(fallbackPoster, size) : '';
  const key = `${mediaType}:${mediaId}:${size}:${fallbackUrl}`;
  const cached = posterPromiseCache.get(key);
  if (cached) return cached;

  const task = (async () => {
    const payload = await fetchJsonWithRetry(
      buildTmdbApiUrl(`${mediaType}/${mediaId}`, {
        append_to_response: 'images',
      }),
      3
    );

    const posters: TmdbPoster[] = Array.isArray(payload?.images?.posters) ? payload.images.posters : [];
    const preferredPath = pickPreferredPosterPath(posters, payload?.original_language);
    if (!preferredPath) return fallbackUrl;
    return posterPathToSiteUrl(preferredPath, size);
  })();

  posterPromiseCache.set(key, task);
  return task;
}

type EntryWithPoster = {
  tmdb_id: number;
  poster: string;
  media_type?: 'movie' | 'tv';
};

export async function enrichEntriesWithPreferredPosters<T extends EntryWithPoster>(
  entries: T[],
  defaultMediaType: 'movie' | 'tv' | 'both',
  size: string = 'w500'
): Promise<T[]> {
  return await Promise.all(
    entries.map(async (entry) => {
      const mediaType = (entry.media_type || (defaultMediaType === 'tv' ? 'tv' : 'movie')) as MediaType;
      const preferredPoster = await getPreferredPosterUrlForMedia(mediaType, entry.tmdb_id, entry.poster || '', size);
      return {
        ...entry,
        poster: preferredPoster || entry.poster,
      };
    })
  );
}
