// ==========================================
// 多语言数据回退工具(API侧)
// ==========================================
import { pickPreferredTmdbImagePath } from './tmdbImagePriority';

const LANGUAGE_PRIORITY = ['zh-CN', 'zh', 'zh-SG', 'zh-TW', 'zh-HK', 'en'] as const;

type LanguageCode = typeof LANGUAGE_PRIORITY[number];

type TmdbImageItem = {
  file_path?: string;
  iso_639_1?: string | null;
  iso_3166_1?: string | null;
};

function isEmpty(value: any): boolean {
  return value === null || value === undefined || value === '';
}

function isStringEmpty(value: any): boolean {
  if (typeof value !== 'string') return isEmpty(value);
  return value.trim() === '';
}

function isArrayEmpty(value: any): boolean {
  return !Array.isArray(value) || value.length === 0;
}

function getFieldValue<T>(
  field: string,
  dataList: Array<{ data: any; lang: LanguageCode }>,
  checkEmpty: (value: any) => boolean = isStringEmpty
): T | undefined {
  for (const { data } of dataList) {
    const value = getNestedValue(data, field);
    if (!checkEmpty(value)) {
      return value as T;
    }
  }
  return undefined;
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

function pickPreferredPosterPath(data: any): string | undefined {
  const posters: TmdbImageItem[] = Array.isArray(data?.images?.posters) ? data.images.posters : [];
  return pickPreferredTmdbImagePath(posters, data?.original_language);
}

export function mergeMultiLanguageData(dataList: Array<{ data: any; lang: LanguageCode }>): any {
  if (dataList.length === 0) return null;
  
  const baseData = dataList[0].data;
  const merged = { ...baseData };
  
  const keyFields = [
    'title',
    'name',
    'original_title',
    'original_name',
    'overview',
    'tagline',
  ];
  
  for (const field of keyFields) {
    if (isStringEmpty(merged[field])) {
      const value = getFieldValue(field, dataList);
      if (value !== undefined) {
        merged[field] = value;
      }
    }
  }
  
  if (isArrayEmpty(merged.genres)) {
    const genres = getFieldValue('genres', dataList, isArrayEmpty);
    if (genres) {
      merged.genres = genres;
    }
  }
  
  if (merged.seasons && Array.isArray(merged.seasons)) {
    merged.seasons = merged.seasons.map((season: any, index: number) => {
      const seasonMerged = { ...season };
      
      if (isStringEmpty(seasonMerged.name)) {
        for (const { data } of dataList) {
          if (data.seasons?.[index]?.name && !isStringEmpty(data.seasons[index].name)) {
            seasonMerged.name = data.seasons[index].name;
            break;
          }
        }
      }
      
      if (isStringEmpty(seasonMerged.overview)) {
        for (const { data } of dataList) {
          if (data.seasons?.[index]?.overview && !isStringEmpty(data.seasons[index].overview)) {
            seasonMerged.overview = data.seasons[index].overview;
            break;
          }
        }
      }
      
      return seasonMerged;
    });
  }

  const preferredPosterPath = pickPreferredPosterPath(merged);
  if (preferredPosterPath) {
    merged.poster_path = preferredPosterPath;
  }
  
  return merged;
}

export async function fetchTMDBWithLanguageFallback(
  url: string,
  baseParams: Record<string, any> = {},
  appendToResponse?: string
): Promise<any> {
  const REQUEST_TIMEOUT_MS = 12_000;

  const fetchOne = async (lang: LanguageCode) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const params = new URLSearchParams({
        ...baseParams,
        language: lang,
      });

      if (appendToResponse) {
        params.append('append_to_response', appendToResponse);
      }

      const apiKey = import.meta.env.VITE_TMDB_API_KEY as string | undefined;
      if (apiKey) {
        params.append('api_key', apiKey);
      }

      const response = await fetch(`${url}?${params.toString()}`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        return { lang, data: null as any, error: `HTTP ${response.status}` };
      }

      const data = await response.json();

      if (data?.status_code && data.status_code !== 1) {
        return { lang, data: null as any, error: data.status_message || 'Unknown error' };
      }

      return { lang, data, error: null as any };
    } catch (error) {
      const message =
        error instanceof Error ? (error.name === 'AbortError' ? 'Timeout' : error.message) : String(error);
      return { lang, data: null as any, error: message };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const dataList: Array<{ data: any; lang: LanguageCode }> = [];
  const errors: Array<{ lang: LanguageCode; error: any }> = [];

  for (const lang of LANGUAGE_PRIORITY) {
    const result = await fetchOne(lang);
    if (result.data) {
      dataList.push({ data: result.data, lang });

      const mergedSoFar = mergeMultiLanguageData(dataList);
      const hasTitle =
        !isStringEmpty(mergedSoFar?.title) ||
        !isStringEmpty(mergedSoFar?.name) ||
        !isStringEmpty(mergedSoFar?.original_title) ||
        !isStringEmpty(mergedSoFar?.original_name);
      const hasOverview = !isStringEmpty(mergedSoFar?.overview);

      if (hasTitle && hasOverview) {
        return mergedSoFar;
      }
    } else {
      errors.push({ lang, error: result.error });
    }
  }

  if (dataList.length === 0) {
    throw new Error(`所有语言版本获取失败: ${errors.map(e => `${e.lang}: ${e.error}`).join(', ')}`);
  }

  return mergeMultiLanguageData(dataList);
}

export function getLanguagePriority(): readonly LanguageCode[] {
  return LANGUAGE_PRIORITY;
}

export function getPrimaryLanguage(): LanguageCode {
  return LANGUAGE_PRIORITY[0];
}
