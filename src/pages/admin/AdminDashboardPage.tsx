// ==========================================
// 管理端仪表盘页
// ==========================================
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, PenLine, Edit3, Eye, MoreHorizontal, ArrowRight, MessageCircle, Lock, Users } from 'lucide-react';

const LINKS = [
  { path: '/admin/charts', label: '榜单管理', desc: '管理各平台榜单、录入与更新', icon: BarChart3 },
  { path: '/admin/ratings/input', label: '评分手动录入', desc: '为影视添加各平台评分数据', icon: PenLine },
  { path: '/admin/ratings/edit', label: '评分数据修改', desc: '修改已有影视的各平台评分', icon: Edit3 },
  { path: '/admin/users', label: '用户管理', desc: '按昵称搜索用户并进行封锁、删除等操作', icon: Users },
  { path: '/admin/platform-status', label: '平台锁定', desc: '查看并管理各平台抓取锁定状态', icon: Lock,},
  { path: '/admin/detail-views', label: '访问记录', desc: '查看用户访问了哪些影视详情页', icon: Eye },
  { path: '/admin/feedbacks', label: '用户反馈', desc: '查看并回复用户反馈', icon: MessageCircle },
  { path: '/admin/other', label: '其他功能', desc: '更多管理功能敬请期待', icon: MoreHorizontal },
];

export default function AdminDashboardPage() {
  useEffect(() => {
    document.title = '管理员后台 - RateFuse';
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">
        管理后台
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm sm:text-base">
        选择左侧菜单或下方入口进入相应管理功能
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 py-2">
        {LINKS.map(({ path, label, desc, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            className="group flex items-start gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-lg hover:-translate-y-0.5 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-all duration-200"
          >
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {label}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 flex-shrink-0 mt-1" />
          </Link>
        ))}
      </div>
    </div>
  );
}
