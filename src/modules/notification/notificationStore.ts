// ==========================================
// 通知全局状态仓库
// ==========================================
import { create, type StateCreator } from 'zustand';
import {
  deleteNotifications,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  type NotificationItem,
} from '../../api/notifications';

export interface NotificationState {
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  initialized: boolean;
  error?: string;
  fetchAll: () => Promise<void>;
  markOneAsReadOptimistic: (id: number) => Promise<void>;
  markAllAsReadOptimistic: () => Promise<void>;
  deleteOneOptimistic: (id: number) => Promise<void>;
  deleteAllOptimistic: () => Promise<void>;
  setUnreadCountFromServer: (count: number) => void;
}

const creator: StateCreator<NotificationState> = (set: (partial: NotificationState | Partial<NotificationState>) => void, get: () => NotificationState) => ({
  items: [],
  unreadCount: 0,
  loading: false,
  initialized: false,
  error: undefined,

  fetchAll: async () => {
    const { initialized, loading } = get();
    if (initialized && loading) return;
    set({ loading: true, error: undefined });
    try {
      const [items, unread]: [NotificationItem[], number] = await Promise.all([
        getNotifications({ limit: 100, offset: 0 }),
        getUnreadNotificationCount(),
      ]);
      const safeItems: NotificationItem[] = Array.isArray(items) ? items : [];
      set({
        items: safeItems,
        unreadCount: typeof unread === 'number' ? unread : safeItems.filter((n) => !n.is_read).length,
        loading: false,
        initialized: true,
      });
    } catch (e: any) {
      const message = e?.message || '获取通知失败';
      set({ loading: false, initialized: true, error: message, items: [] });
    }
  },

  markOneAsReadOptimistic: async (id: number) => {
    const prev = get();
    const target = prev.items.find((n: NotificationItem) => n.id === id);
    if (!target || target.is_read) return;

    const prevItems = prev.items;
    const prevUnread = prev.unreadCount;

    const nextItems = prevItems.map((n) => (n.id === id ? { ...n, is_read: true } : n));
    set({
      items: nextItems,
      unreadCount: Math.max(0, prevUnread - 1),
    });

    try {
      await markNotificationsRead({ ids: [id] });
    } catch {
      set({
        items: prevItems,
        unreadCount: prevUnread,
      });
      throw new Error('标记已读失败');
    }
  },

  markAllAsReadOptimistic: async () => {
    const prev = get();
    if (prev.unreadCount === 0) return;

    const prevItems = prev.items;
    const prevUnread = prev.unreadCount;

    const nextItems = prevItems.map((n) => (n.is_read ? n : { ...n, is_read: true }));
    set({
      items: nextItems,
      unreadCount: 0,
    });

    try {
      await markNotificationsRead({ all: true });
    } catch {
      set({
        items: prevItems,
        unreadCount: prevUnread,
      });
      throw new Error('全部已读失败');
    }
  },

  deleteOneOptimistic: async (id: number) => {
    const prev = get();
    const prevItems = prev.items;
    const prevUnread = prev.unreadCount;
    const toDelete = prevItems.find((n) => n.id === id);
    if (!toDelete) return;

    const nextItems = prevItems.filter((n) => n.id !== id);
    const nextUnread = toDelete.is_read ? prevUnread : Math.max(0, prevUnread - 1);

    set({
      items: nextItems,
      unreadCount: nextUnread,
    });

    try {
      await deleteNotifications({ ids: [id] });
    } catch {
      set({
        items: prevItems,
        unreadCount: prevUnread,
      });
      throw new Error('清除失败');
    }
  },

  deleteAllOptimistic: async () => {
    const prev = get();
    const prevItems = prev.items;
    const prevUnread = prev.unreadCount;

    if (prevItems.length === 0) return;

    set({
      items: [],
      unreadCount: 0,
    });

    try {
      await deleteNotifications({ all: true });
    } catch {
      set({
        items: prevItems,
        unreadCount: prevUnread,
      });
      throw new Error('清空失败');
    }
  },

  setUnreadCountFromServer: (count: number) => {
    const safe = Number.isFinite(count) ? count : 0;
    set({ unreadCount: safe < 0 ? 0 : safe });
  },
});

export const useNotificationStore = create<NotificationState>(creator);
