// ==========================================
// 管理后台布局容器
// ==========================================
import { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../modules/auth/AuthContext';
import { ThemeToggle } from '../../shared/ui/ThemeToggle';
import {
  LayoutDashboard,
  BarChart3,
  PenLine,
  Edit3,
  Eye,
  MoreHorizontal,
  Home,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Lock,
  Users,
  Link2,
  FolderSearch,
} from 'lucide-react';
import { cn } from '../../shared/utils/utils';

const SIDEBAR_ITEMS = [
  { id: 'dashboard', path: '/admin', label: '管理首页', icon: LayoutDashboard },
  { id: 'users', path: '/admin/users', label: '用户管理', icon: Users },
  { id: 'charts', path: '/admin/charts', label: '榜单管理', icon: BarChart3 },
  { id: 'rating-input', path: '/admin/ratings/input', label: '评分手动录入', icon: PenLine },
  { id: 'rating-edit', path: '/admin/ratings/edit', label: '评分数据修改', icon: Edit3 },
  { id: 'platform-status', path: '/admin/platform-status', label: '平台锁定', icon: Lock },
  { id: 'resources', path: '/admin/resources', label: '资源审核', icon: FolderSearch },
  { id: 'media-link-mapping', path: '/admin/media-link-mapping', label: '链接映射库', icon: Link2 },
  { id: 'feedbacks', path: '/admin/feedbacks', label: '用户反馈', icon: MessageCircle },
  { id: 'detail-views', path: '/admin/detail-views', label: '访问记录', icon: Eye },
  { id: 'other', path: '/admin/other', label: '其他功能', icon: MoreHorizontal },
];

export default function AdminLayout() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      if (typeof window === 'undefined') return false;
      return localStorage.getItem('admin_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.title = '管理后台 - RateFuse';
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('admin_sidebar_collapsed', collapsed ? '1' : '0');
    } catch {
    }
  }, [collapsed]);

  const sidebarClassName = useMemo(() => {
    return cn(
      'flex-shrink-0 border-b sm:border-b-0 sm:border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/50 transition-all duration-200 ease-in-out',
      collapsed ? 'w-full sm:w-16 lg:w-16' : 'w-full sm:w-56 lg:w-64'
    );
  }, [collapsed]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <span className="text-gray-500 dark:text-gray-400">加载中...</span>
      </div>
    );
  }

  if (!user?.is_admin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 dark:bg-gray-900 p-4">
        <p className="text-red-500 dark:text-red-400 font-medium">无权限（仅管理员可访问）</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col sm:flex-row bg-gray-50 dark:bg-gray-900">
      {/* 侧边栏 */}
      <aside className={sidebarClassName}>
        <div className="p-4 flex items-center justify-between sm:flex-col sm:items-stretch sm:gap-4">
          <div className="flex items-center gap-2">
            <span className={cn('font-bold text-gray-900 dark:text-white', collapsed && 'hidden')}>管理后台</span>
            <ThemeToggle />
          </div>

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={cn(
              'mt-2 inline-flex items-center justify-center rounded-lg border transition-colors',
              'w-9 h-9 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
            )}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          <nav className="flex gap-2 overflow-x-auto sm:flex-col sm:overflow-visible pb-2 sm:pb-0 -mx-2 sm:mx-0 px-2 sm:px-0">
            {SIDEBAR_ITEMS.map(({ id, path, label, icon: Icon }) => (
              <NavLink
                key={id}
                to={path}
                end={path === '/admin'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                    collapsed && 'px-2 justify-center',
                    isActive
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white'
                  )
                }
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className={cn(collapsed && 'hidden')}>{label}</span>
              </NavLink>
            ))}
          </nav>
          <NavLink
            to="/"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white mt-auto hidden sm:flex',
              collapsed && 'px-2 justify-center'
            )}
          >
            <Home className="w-4 h-4" />
            <span className={cn(collapsed && 'hidden')}>返回前台</span>
          </NavLink>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
