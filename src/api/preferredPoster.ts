// ==========================================
// 首选海报 URL 获取工具
// ==========================================
import { buildTmdbApiUrl } from './api';
import { posterPathToSiteUrl } from './image';

type MediaType = 'movie' | 'tv';

type TmdbPoster = {
  file_path?: string;
  iso_639_1?: string | null;
};

const POSTER_LANGUAGE_PRIORITY = ['zh-CN', 'zh', 'zh-SG', 'zh-TW', 'zh-HK', 'en'] as const;
const posterPromiseCache = new Map<string, Promise<string>>();

function normalizeLanguageTag(language: string | null | undefined): string {
  return (language || '').trim().toLowerCase().replace('_', '-');
}

function matchesLanguage(candidate: string | null | undefined, target: string): boolean {
  const candidateNorm = normalizeLanguageTag(candidate);
  const targetNorm = normalizeLanguageTag(target);
  if (!candidateNorm || !targetNorm) return false;
  return candidateNorm === targetNorm || candidateNorm.startsWith(`${targetNorm}-`);
}

function pickPreferredPosterPath(
  posters: TmdbPoster[],
  originalLanguage: string | null | undefined
): string | undefined {
  if (!Array.isArray(posters) || posters.length === 0) return undefined;

  for (const lang of POSTER_LANGUAGE_PRIORITY) {
    const match = posters.find((poster) => poster.file_path && matchesLanguage(poster.iso_639_1, lang));
    if (match?.file_path) return match.file_path;
  }

  const originalLanguageNorm = normalizeLanguageTag(originalLanguage);
  if (originalLanguageNorm) {
    const originalMatch = posters.find(
      (poster) => poster.file_path && matchesLanguage(poster.iso_639_1, originalLanguageNorm)
    );
    if (originalMatch?.file_path) return originalMatch.file_path;
  }

  const noLanguageMatch = posters.find((poster) => poster.file_path && poster.iso_639_1 === null);
  if (noLanguageMatch?.file_path) return noLanguageMatch.file_path;

  return posters.find((poster) => poster.file_path)?.file_path;
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
    try {
      const response = await fetch(
        buildTmdbApiUrl(`${mediaType}/${mediaId}`, {
          language: 'zh-CN',
          append_to_response: 'images',
          include_image_language: 'zh-CN,zh-SG,zh-TW,zh-HK,en,null',
        })
      );
      if (!response.ok) return fallbackUrl;

      const data = await response.json();
      const posters: TmdbPoster[] = Array.isArray(data?.images?.posters) ? data.images.posters : [];
      const preferredPath = pickPreferredPosterPath(posters, data?.original_language);
      if (!preferredPath) return fallbackUrl;
      return posterPathToSiteUrl(preferredPath, size);
    } catch {
      return fallbackUrl;
    }
  })();

  posterPromiseCache.set(key, task);
  return task;
}
