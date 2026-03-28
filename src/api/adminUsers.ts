// ==========================================
// 管理端用户管理 API 模块
// ==========================================
import { authFetchJson } from './authFetch';
import { authFetch } from './authFetch';

export interface AdminUserItem {
  id: number;
  username: string;
  email: string;
  avatar: string | null;
  is_admin: boolean;
  is_banned: boolean;
  created_at: string | null;
}

export interface AdminUserListResponse {
  list: AdminUserItem[];
  total: number;
}

export async function fetchAdminUsers(params: {
  q: string;
  banned?: 'all' | 'banned' | 'normal';
  limit?: number;
  offset?: number;
}): Promise<AdminUserListResponse> {
  const sp = new URLSearchParams();
  sp.set('q', params.q);
  if (params.banned && params.banned !== 'all') {
    sp.set('banned', params.banned);
  }
  if (params.limit != null) sp.set('limit', String(params.limit));
  if (params.offset != null) sp.set('offset', String(params.offset));

  return await authFetchJson<AdminUserListResponse>(`/api/admin/users?${sp.toString()}`);
}

async function simplePost(url: string, options: RequestInit) {
  const res = await authFetch(url, options as any);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail || '操作失败');
  }
}

export async function deleteUserByAdmin(userId: number) {
  await simplePost(`/api/admin/users/${userId}`, { method: 'DELETE' });
}

export async function banUserByAdmin(userId: number) {
  await simplePost(`/api/admin/users/${userId}/ban`, { method: 'POST' });
}

export async function unbanUserByAdmin(userId: number) {
  await simplePost(`/api/admin/users/${userId}/unban`, { method: 'POST' });
}
