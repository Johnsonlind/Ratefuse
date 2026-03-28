// ==========================================
// 通知中心 API 服务
// ==========================================
import { authFetchJson, authFetch } from './authFetch';

export type NotificationType =
  | 'feedback_reply'
  | 'feedback_new'
  | 'feedback_update'
  | 'follow_user_update'
  | 'follow_user_new_list'
  | 'follow_user_new_follower';

export interface NotificationItem {
  id: number;
  user_id: number;
  type: NotificationType | string;
  content: string;
  link?: string | null;
  is_read: boolean;
  created_at?: string | null;
}

export function getNotifications(params?: {
  limit?: number;
  offset?: number;
  unread_only?: boolean;
}) {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set('limit', String(params.limit));
  if (params?.offset != null) sp.set('offset', String(params.offset));
  if (params?.unread_only != null) sp.set('unread_only', params.unread_only ? 'true' : 'false');
  const qs = sp.toString();
  return authFetchJson<NotificationItem[]>(`/api/notifications${qs ? `?${qs}` : ''}`);
}

export async function getUnreadNotificationCount() {
  const data = await authFetchJson<{ count: number }>('/api/notifications/unread-count');
  return data.count ?? 0;
}

export async function markNotificationsRead(input: { ids?: number[]; all?: boolean }) {
  const res = await authFetch('/api/notifications/read', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = typeof data?.detail === 'string' ? data.detail : '';
    } catch {}
    throw new Error(detail || `Request failed: ${res.status}`);
  }
  return (await res.json()) as { updated: number };
}

export async function deleteNotifications(input: { ids?: number[]; all?: boolean }) {
  const res = await authFetch('/api/notifications', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = typeof data?.detail === 'string' ? data.detail : '';
    } catch {}
    throw new Error(detail || `Request failed: ${res.status}`);
  }
  return (await res.json()) as { deleted: number };
}
