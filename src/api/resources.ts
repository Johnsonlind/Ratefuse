import { authFetchJson } from './authFetch';

export type ResourceType = 'baidu' | 'quark' | 'xunlei' | '115' | 'uc' | 'ali' | 'magnet';

export interface ResourceItem {
  id: number;
  media_type: string;
  tmdb_id: number;
  media_title: string;
  media_year?: number;
  resource_type: ResourceType;
  link: string;
  extraction_code?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  is_favorited?: boolean;
}

export const RESOURCE_TYPES: ResourceType[] = ['baidu', 'quark', 'xunlei', '115', 'uc', 'ali', 'magnet'];

export async function fetchMediaResources(mediaType: string, tmdbId: string | number) {
  return authFetchJson<{ disclaimer: string; resources: ResourceItem[]; approved_types: ResourceType[] }>(
    `/api/resources/${mediaType}/${tmdbId}`
  );
}

export async function fetchMySharedResources() {
  return authFetchJson<ResourceItem[]>(`/api/user/resources/shared`);
}

export async function fetchMyFavoriteResources() {
  return authFetchJson<ResourceItem[]>(`/api/user/resources/favorites`);
}

export async function submitResource(payload: Record<string, unknown>) {
  return authFetchJson<ResourceItem>('/api/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateResource(resourceId: number, payload: Record<string, unknown>) {
  return authFetchJson<ResourceItem>(`/api/resources/${resourceId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteResource(resourceId: number) {
  return authFetchJson<{ ok: boolean }>(`/api/resources/${resourceId}`, {
    method: 'DELETE',
  });
}

export async function favoriteResource(resourceId: number) {
  return authFetchJson(`/api/resources/${resourceId}/favorite`, { method: 'POST' });
}

export async function unfavoriteResource(resourceId: number) {
  return authFetchJson(`/api/resources/${resourceId}/favorite`, { method: 'DELETE' });
}
