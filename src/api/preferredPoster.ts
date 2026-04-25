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
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(
        buildTmdbApiUrl(`${mediaType}/${mediaId}/images`, {
          include_image_language: 'zh-CN,zh-SG,zh-TW,zh-HK,zh,en,null',
        })
      );
      if (response.ok) return await response.json();
      if (response.status === 429 && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }
      return null;
    } catch {
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 120 * attempt));
        continue;
      }
      return null;
    }
  }
  return null;
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
      fetch(buildTmdbApiUrl(`${mediaType}/${mediaId}`, { language: 'zh-CN' }))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
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
