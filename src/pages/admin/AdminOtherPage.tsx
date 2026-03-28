// ==========================================
// 管理端预留页
// ==========================================
import { useEffect } from 'react';
import { Construction } from 'lucide-react';

export default function AdminOtherPage() {
  useEffect(() => {
    document.title = '其他功能 - RateFuse';
  }, []);
  
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">
        其他功能
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        更多管理功能将在此处添加
      </p>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-12 text-center">
        <Construction className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-500 mb-4" />
        <p className="text-gray-600 dark:text-gray-400 font-medium">敬请期待</p>
      </div>
    </div>
  );
}
