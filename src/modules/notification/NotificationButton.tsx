// ==========================================
// 通知入口按钮组件
// ==========================================
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useEffect } from 'react';
import { useAuth } from '../../modules/auth/AuthContext';
import { getUnreadNotificationCount } from '../../api/notifications';
import { useNotificationStore } from '../../modules/notification/notificationStore';

export function NotificationButton() {
  const { user } = useAuth();
  const { unreadCount, setUnreadCountFromServer, fetchAll } = useNotificationStore();

  useEffect(() => {
    if (!user) {
      setUnreadCountFromServer(0);
      return;
    }

    let cancelled = false;
    const fetchCount = async () => {
      try {
        const c = await getUnreadNotificationCount();
        if (!cancelled) setUnreadCountFromServer(c);
      } catch {
        if (!cancelled) setUnreadCountFromServer(0);
      }
    };

    fetchAll();
    fetchCount();
    const timer = window.setInterval(fetchCount, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchCount();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  if (!user) return null;

  const display = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <Link
      to="/notifications"
      className="w-7 h-7 flex items-center justify-center rounded-full glass-button transition-all duration-200 hover:scale-110 relative"
      aria-label={unreadCount > 0 ? `通知（未读 ${unreadCount}）` : '通知'}
    >
      <Bell className="w-5 h-5 text-gray-800 dark:text-white" />
      {unreadCount > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center"
          aria-label={`未读 ${unreadCount}`}
        >
          {display}
        </span>
      )}
    </Link>
  );
}
