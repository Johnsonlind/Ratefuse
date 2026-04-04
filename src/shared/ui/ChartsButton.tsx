// ==========================================
// 榜单入口按钮组件
// ==========================================
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';

export const ChartsButton = () => {
  return (
    <Link 
      to="/charts" 
      className="w-7 h-7 flex items-center justify-center rounded-full glass-button transition-all duration-200 hover:scale-110"
      aria-label="榜单"
    >
      <Trophy className="w-5 h-5 text-gray-800 dark:text-white" />
    </Link>
  );
};
