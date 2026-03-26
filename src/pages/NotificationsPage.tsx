// ==========================================
// 通知页面
// ==========================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../modules/layout/PageShell';
import { useAuth } from '../modules/auth/AuthContext';
import { type NotificationItem } from '../api/notifications';
import { toast } from 'sonner';
import { formatChinaDateTime } from '../shared/utils/time';
import { useNotificationStore } from '../modules/notification/notificationStore';
import { ConfirmDialog } from '../shared/ui/ConfirmDialog';

export default function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const { items, unreadCount, loading, fetchAll, markOneAsReadOptimistic, markAllAsReadOptimistic, deleteOneOptimistic, deleteAllOptimistic } =
    useNotificationStore();

  useEffect(() => {
    if (!user) return;
    fetchAll();
  }, [user]);

  const handleOpen = async (n: NotificationItem) => {
    if (!n.is_read) {
      try {
        await markOneAsReadOptimistic(n.id);
      } catch (e: any) {
        toast.error(e?.message || '标记已读失败');
      }
    }

    const link = (n.link || '').trim();
    if (link) navigate(link);
  };

  const handleMarkAllRead = async () => {
    if (!user || unreadCount === 0) return;
    try {
      await markAllAsReadOptimistic();
      toast.success('已全部标记为已读');
    } catch (e: any) {
      toast.error(e?.message || '操作失败');
    }
  };

  const handleDeleteOne = async (id: number) => {
    try {
      setDeleting(true);
      await deleteOneOptimistic(id);
      toast.success('已清除通知');
    } catch (e: any) {
      toast.error(e?.message || '清除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    try {
      setDeleting(true);
      await deleteAllOptimistic();
      toast.success('已清空通知');
    } catch (e: any) {
      toast.error(e?.message || '清空失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageShell maxWidth="4xl">
      <div className="py-8">
        <div className="flex items-center justify-end gap-2 flex-wrap">
            <button
              className="px-3 py-1.5 rounded-full text-sm home-top-tone-button no-hover-scale"
              onClick={fetchAll}
              disabled={!user || loading || deleting}
            >
              刷新
            </button>
            <button
              className="px-3 py-1.5 rounded-full text-sm home-top-tone-button no-hover-scale"
              onClick={handleMarkAllRead}
              disabled={!user || loading || deleting || unreadCount === 0}
            >
              全部已读
            </button>
            <button
              className="px-3 py-1.5 rounded-full text-sm home-top-tone-button no-hover-scale"
              onClick={() => setConfirmDeleteAllOpen(true)}
              disabled={!user || loading || deleting || items.length === 0}
            >
              清空
            </button>
        </div>

        {!user ? (
          <div className="mt-6 text-sm text-gray-600 dark:text-gray-400">请先登录后查看通知。</div>
        ) : items.length === 0 ? (
          <div className="mt-10 flex items-center justify-center py-12">
            <div className="text-sm text-gray-600 dark:text-gray-400">暂无通知</div>
          </div>
        ) : (
          <div className="mt-6 space-y-2">
            {items.map((n: NotificationItem) => {
              const timeText = n.created_at ? formatChinaDateTime(n.created_at) : '';
              return (
                <button
                  key={n.id}
                  onClick={() => handleOpen(n)}
                  className={`w-full text-left glass-card rounded-2xl p-4 sm:p-5 transition-shadow ring-1 ring-white/10 dark:ring-white/5 hover:shadow-md ${
                    n.is_read ? 'opacity-75' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {!n.is_read && <span className="w-2 h-2 rounded-full bg-red-500" aria-label="未读" />}
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                          {n.content}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                      {!n.is_read && (
                        <button
                          type="button"
                          className="no-hover-scale text-xs px-2 py-1 rounded-full home-top-tone-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void markOneAsReadOptimistic(n.id).catch((err: any) => {
                              toast.error(err?.message || '标记已读失败');
                            });
                          }}
                          disabled={deleting}
                          aria-label="标记该通知为已读"
                        >
                          标记已读
                        </button>
                      )}
                      <button
                        type="button"
                        className="no-hover-scale text-xs px-2 py-1 rounded-full home-top-tone-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteOne(n.id);
                        }}
                        disabled={deleting}
                        aria-label="清除该通知"
                      >
                        清除
                      </button>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{timeText}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmDeleteAllOpen}
        title="清空通知"
        message="确定要清空所有通知吗？此操作不可恢复。"
        confirmText={deleting ? '清空中...' : '确定'}
        cancelText="取消"
        variant="danger"
        onCancel={() => setConfirmDeleteAllOpen(false)}
        onConfirm={() => {
          setConfirmDeleteAllOpen(false);
          void handleDeleteAll();
        }}
      />
    </PageShell>
  );
}
