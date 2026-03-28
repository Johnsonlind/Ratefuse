// ==========================================
// 认证失败页
// ==========================================
import { useNavigate } from 'react-router-dom';

import { useEffect } from 'react';

export default function AuthErrorPage() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = '验证失败 - RateFuse';
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-400 to-indigo-600 flex items-center justify-center p-4">
      <div className="glass-card rounded-2xl p-8 w-full max-w-md text-center">
        <h1 className="text-2xl font-bold mb-4 dark:text-white">验证链接无效</h1>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          该链接可能已过期或已被使用。请重新发起密码重置请求。
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          返回首页
        </button>
      </div>
    </div>
  );
} 
