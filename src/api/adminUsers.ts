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
  is_member: boolean;
  member_expired_at?: string | null;
  created_at: string | null;
}

export interface AdminUserListResponse {
  list: AdminUserItem[];
  total: number;
}

export async function fetchAdminUsers(params: {
  q: string;
  banned?: 'all' | 'banned' | 'normal';
  member?: 'all' | 'member' | 'normal';
  limit?: number;
  offset?: number;
}): Promise<AdminUserListResponse> {
  const sp = new URLSearchParams();
  sp.set('q', params.q);
  if (params.banned && params.banned !== 'all') {
    sp.set('banned', params.banned);
  }
  if (params.member && params.member !== 'all') {
    sp.set('member', params.member);
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

export async function setUserMemberByAdmin(userId: number, is_member: boolean, days = 30) {
  await simplePost(`/api/admin/users/${userId}/member`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_member, days }),
  });
}

export async function setUsersMemberBatchByAdmin(ids: number[], is_member: boolean, days = 30) {
  await simplePost(`/api/admin/users/member/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, is_member, days }),
  });
}
