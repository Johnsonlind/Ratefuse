// ==========================================
// 首选海报 URL 获取工具
// ==========================================
import { buildTmdbApiUrl } from './api';
import { posterPathToSiteUrl } from './image';

type MediaType = 'movie' | 'tv';

type TmdbPoster = {
  file_path?: string;
  iso_639_1?: string | null;
  iso_3166_1?: string | null;
};

const posterPromiseCache = new Map<string, Promise<string>>();
const TMDB_FETCH_CONCURRENCY = 6;
let tmdbInFlight = 0;
const tmdbQueue: Array<() => void> = [];

function normalizeLanguageTag(language: string | null | undefined): string {
  return (language || '').trim().toLowerCase().replace('_', '-');
}

function matchesLanguage(candidate: string | null | undefined, target: string): boolean {
  const candidateNorm = normalizeLanguageTag(candidate);
  const targetNorm = normalizeLanguageTag(target);
  if (!candidateNorm || !targetNorm) return false;
  if (candidateNorm === targetNorm || candidateNorm.startsWith(`${targetNorm}-`)) return true;
  const candidateBase = candidateNorm.split('-')[0];
  const targetBase = targetNorm.split('-')[0];
  return candidateBase === targetBase;
}

function normalizeRegionTag(region: string | null | undefined): string {
  return (region || '').trim().toUpperCase();
}

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

async function fetchJsonWithRetry(url: string, attempts = 4): Promise<any | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await runWithTmdbFetchQueue(() => fetch(url));
      if (response.ok) return await response.json();

      const canRetry = response.status === 429 || response.status >= 500;
      if (!canRetry || attempt === attempts) return null;
    } catch {
      if (attempt === attempts) return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 180 * attempt));
  }
  return null;
}

function getPosterPriority(poster: TmdbPoster, originalLanguage: string | null | undefined): number {
  const lang = normalizeLanguageTag(poster.iso_639_1);
  const region = normalizeRegionTag(poster.iso_3166_1);
  const original = normalizeLanguageTag(originalLanguage);

  if (!poster.file_path) return 999;

  if (matchesLanguage(lang, 'zh')) {
    if (region === 'CN') return 0;
    if (region === 'SG') return 1;
    if (region === 'TW') return 2;
    if (region === 'HK') return 3;
    return 4;
  }

  if (matchesLanguage(lang, 'en')) return 5;
  if (original && matchesLanguage(lang, original)) return 6;
  if (poster.iso_639_1 === null) return 7;
  return 8;
}

function pickPreferredPosterPath(
  posters: TmdbPoster[],
  originalLanguage: string | null | undefined
): string | undefined {
  if (!Array.isArray(posters) || posters.length === 0) return undefined;

  const sorted = posters
    .filter((poster) => !!poster.file_path)
    .sort((a, b) => getPosterPriority(a, originalLanguage) - getPosterPriority(b, originalLanguage));
  return sorted[0]?.file_path;
}

async function fetchImagesPayload(mediaType: MediaType, mediaId: string | number): Promise<any | null> {
  return await fetchJsonWithRetry(
    buildTmdbApiUrl(`${mediaType}/${mediaId}/images`, {
      include_image_language: 'zh-CN,zh-SG,zh-TW,zh-HK,zh,en,null',
    }),
    4
  );
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
    const [detailData, imagesData] = await Promise.all([
      fetchJsonWithRetry(buildTmdbApiUrl(`${mediaType}/${mediaId}`, { language: 'zh-CN' }), 3),
      fetchImagesPayload(mediaType, mediaId),
    ]);

    const posters: TmdbPoster[] = Array.isArray(imagesData?.posters) ? imagesData.posters : [];
    const preferredPath = pickPreferredPosterPath(posters, detailData?.original_language);
    if (!preferredPath) return fallbackUrl;
    return posterPathToSiteUrl(preferredPath, size);
  })();

  posterPromiseCache.set(key, task);
  return task;
}
