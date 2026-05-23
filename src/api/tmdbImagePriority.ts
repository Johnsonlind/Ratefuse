// ==========================================
// TMDB 图片语言优先级工具
// ==========================================
type TmdbLocalizedImage = {
  file_path?: string;
  iso_639_1?: string | null;
  iso_3166_1?: string | null;
};

type TmdbImagePriorityMode = 'default' | 'heroPoster';

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

function matchesZhLocale(image: TmdbLocalizedImage, regionCode: string): boolean {
  const lang = normalizeLanguageTag(image.iso_639_1);
  const region = normalizeRegionTag(image.iso_3166_1);
  const targetRegion = regionCode.toUpperCase();
  const targetTag = `zh-${targetRegion.toLowerCase()}`;

  if (lang === targetTag) return true;
  if (!matchesLanguage(lang, 'zh')) return false;
  return region === targetRegion;
}

function matchesEnUS(image: TmdbLocalizedImage): boolean {
  const lang = normalizeLanguageTag(image.iso_639_1);
  const region = normalizeRegionTag(image.iso_3166_1);
  if (lang === 'en-us') return true;
  if (!matchesLanguage(lang, 'en')) return false;
  return region === 'US';
}

function isUndefinedLanguage(image: TmdbLocalizedImage): boolean {
  const lang = image.iso_639_1;
  return lang === null || lang === undefined || lang === '';
}

export function getTmdbImageLanguagePriority(
  image: TmdbLocalizedImage,
  originalLanguage: string | null | undefined,
  _mode: TmdbImagePriorityMode = 'default'
): number {
  if (!image.file_path) return 999;

  if (matchesZhLocale(image, 'CN')) return 0;
  if (matchesZhLocale(image, 'SG')) return 1;
  if (matchesZhLocale(image, 'TW')) return 2;
  if (matchesZhLocale(image, 'HK')) return 3;
  if (matchesEnUS(image)) return 4;

  const original = normalizeLanguageTag(originalLanguage);
  const lang = normalizeLanguageTag(image.iso_639_1);
  if (original && matchesLanguage(lang, original)) return 5;

  if (isUndefinedLanguage(image)) return 7;

  return 6;
}

export function pickPreferredTmdbImagePath<T extends TmdbLocalizedImage>(
  images: T[],
  originalLanguage: string | null | undefined,
  mode: TmdbImagePriorityMode = 'default'
): string | undefined {
  if (!Array.isArray(images) || images.length === 0) return undefined;

  const sorted = images.filter((image) => !!image.file_path).sort((a, b) => {
    const pa = getTmdbImageLanguagePriority(a, originalLanguage, mode);
    const pb = getTmdbImageLanguagePriority(b, originalLanguage, mode);
    if (pa !== pb) return pa - pb;
    const aHasRegion = !!normalizeRegionTag(a.iso_3166_1);
    const bHasRegion = !!normalizeRegionTag(b.iso_3166_1);
    if (aHasRegion !== bHasRegion) return aHasRegion ? -1 : 1;
    return 0;
  });

  return sorted[0]?.file_path;
}

export const TMDB_POSTER_FETCH_LANGUAGES = 'zh-CN,zh,en-US,en,null' as const;

export function buildPosterIncludeImageLanguages(originalLanguage?: string | null): string {
  const langs = TMDB_POSTER_FETCH_LANGUAGES.split(',');
  const orig = (originalLanguage || '').trim().toLowerCase();
  if (orig && !langs.includes(orig)) {
    langs.push(orig);
  }
  return langs.join(',');
}
