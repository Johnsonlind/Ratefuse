// ==========================================
// 管理端影视链接映射库 API
// ==========================================
import { authFetchJson, authFetch } from './authFetch';

export type MediaType = 'movie' | 'tv';
export type MatchStatus = 'auto' | 'manual' | 'conflict';

export interface MediaLinkMappingItem {
  id: number;
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  year: number | null;
  imdb_id: string | null;

  douban_id: string | null;
  douban_url: string | null;
  douban_seasons_json: string | null;
  douban_seasons_ids_json: string | null;
  letterboxd_url: string | null;
  letterboxd_slug: string | null;
  rotten_tomatoes_url: string | null;
  rotten_tomatoes_slug: string | null;
  rotten_tomatoes_seasons_json: string | null;
  metacritic_url: string | null;
  metacritic_slug: string | null;
  metacritic_seasons_json: string | null;

  match_status: MatchStatus;
  confidence: number | null;
  last_verified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  platform_lock_statuses?: Record<string, string>;
}

export interface MediaLinkMappingListResponse {
  items: MediaLinkMappingItem[];
  total: number;
  page: number;
  page_size: number;
}

export async function fetchMediaLinkMappings(params: {
  q?: string;
  tmdb_id?: number;
  page?: number;
  page_size?: 20 | 50 | 100 | 200;
}): Promise<MediaLinkMappingListResponse> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.tmdb_id != null) sp.set('tmdb_id', String(params.tmdb_id));
  if (params.page != null) sp.set('page', String(params.page));
  if (params.page_size != null) sp.set('page_size', String(params.page_size));
  return await authFetchJson<MediaLinkMappingListResponse>(`/api/admin/media-link-mappings?${sp.toString()}`);
}

export async function fetchMediaLinkMappingDetail(id: number): Promise<{ item: MediaLinkMappingItem }> {
  return await authFetchJson<{ item: MediaLinkMappingItem }>(`/api/admin/media-link-mappings/${id}`);
}

export async function createMediaLinkMapping(payload: {
  tmdb_id: number;
  media_type: MediaType;
  douban_id?: string | null;
  douban_url?: string | null;
  douban_seasons_json?: string | null;
  douban_seasons_ids_json?: string | null;
  letterboxd_url?: string | null;
  letterboxd_slug?: string | null;
  rotten_tomatoes_url?: string | null;
  rotten_tomatoes_slug?: string | null;
  rotten_tomatoes_seasons_json?: string | null;
  metacritic_url?: string | null;
  metacritic_slug?: string | null;
  metacritic_seasons_json?: string | null;
}): Promise<{ item: MediaLinkMappingItem }> {
  return await authFetchJson<{ item: MediaLinkMappingItem }>(`/api/admin/media-link-mappings`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  } as any);
}

export async function updateMediaLinkMapping(
  id: number,
  payload: Partial<Pick<
    MediaLinkMappingItem,
    | 'title'
    | 'year'
    | 'imdb_id'
    | 'douban_id'
    | 'douban_url'
    | 'douban_seasons_json'
    | 'douban_seasons_ids_json'
    | 'letterboxd_url'
    | 'letterboxd_slug'
    | 'rotten_tomatoes_url'
    | 'rotten_tomatoes_slug'
    | 'rotten_tomatoes_seasons_json'
    | 'metacritic_url'
    | 'metacritic_slug'
    | 'metacritic_seasons_json'
    | 'confidence'
    | 'last_verified_at'
  >>
): Promise<{ item: MediaLinkMappingItem }> {
  return await authFetchJson<{ item: MediaLinkMappingItem }>(`/api/admin/media-link-mappings/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  } as any);
}

export async function deleteMediaLinkMapping(id: number): Promise<void> {
  const res = await authFetch(`/api/admin/media-link-mappings/${id}`, { method: 'DELETE' } as any);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail || '删除失败');
  }
}
