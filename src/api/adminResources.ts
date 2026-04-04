import { authFetch, authFetchJson } from './authFetch';
import type { ResourceType } from './resources';

export interface AdminResourceItem {
  id: number;
  media_type: 'movie' | 'tv' | string;
  tmdb_id: number;
  media_title: string;
  media_year?: number | null;
  resource_type: ResourceType | string;
  link: string;
  extraction_code?: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  submitted_by: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function fetchAdminResources(status?: string) {
  const sp = new URLSearchParams();
  if (status && status !== 'all') sp.set('status', status);
  return authFetchJson<AdminResourceItem[]>(`/api/admin/resources${sp.toString() ? `?${sp.toString()}` : ''}`);
}

export async function reviewAdminResource(resourceId: number, action: 'approve' | 'reject', reason?: string) {
  const res = await authFetch(`/api/admin/resources/${resourceId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, reason }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail || '审核失败');
  }
  return res.json();
}

