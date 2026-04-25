// ==========================================
// TMDB 图片语言优先级工具
// ==========================================
type TmdbLocalizedImage = {
  file_path?: string;
  iso_639_1?: string | null;
  iso_3166_1?: string | null;
};

function normalizeLanguageTag(language: string | null | undefined): string {
  return (language || '').trim().toLowerCase().replace('_', '-');
}

function normalizeRegionTag(region: string | null | undefined): string {
  return (region || '').trim().toUpperCase();
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

export function getTmdbImageLanguagePriority(
  image: TmdbLocalizedImage,
  originalLanguage: string | null | undefined
): number {
  const lang = normalizeLanguageTag(image.iso_639_1);
  const region = normalizeRegionTag(image.iso_3166_1);
  const original = normalizeLanguageTag(originalLanguage);

  if (!image.file_path) return 999;

  if (matchesLanguage(lang, 'zh') && region === 'CN') return 0;
  if (matchesLanguage(lang, 'zh') && region === 'SG') return 1;
  if (matchesLanguage(lang, 'zh') && region === 'TW') return 2;
  if (matchesLanguage(lang, 'zh') && region === 'HK') return 3;
  if (matchesLanguage(lang, 'en') && region === 'US') return 4;
  if (original && matchesLanguage(lang, original)) return 5;
  if (image.iso_639_1 === null) return 6;
  return 7;
}

export function pickPreferredTmdbImagePath<T extends TmdbLocalizedImage>(
  images: T[],
  originalLanguage: string | null | undefined
): string | undefined {
  if (!Array.isArray(images) || images.length === 0) return undefined;

  const sorted = images
    .filter((image) => !!image.file_path)
    .sort((a, b) => getTmdbImageLanguagePriority(a, originalLanguage) - getTmdbImageLanguagePriority(b, originalLanguage));

  return sorted[0]?.file_path;
}
