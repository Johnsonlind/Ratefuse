// ==========================================
// 认证确认页
// ==========================================
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../modules/auth/AuthContext';

export default function AuthConfirmPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  useAuth();

  useEffect(() => {
    document.title = '验证中 - RateFuse';
  }, []);

  useEffect(() => {
    const handleConfirm = async () => {
      try {
        console.log('开始处理确认页面');
        const token = searchParams.get('token');

        if (!token) {
          console.error('缺少必要的参数');
          navigate('/auth/auth-code-error');
          return;
        }

        navigate(`/reset-password?token=${token}`);
      } catch (err) {
        console.error('确认过程出错:', err);
        navigate('/auth/auth-code-error');
      }
    };

    handleConfirm();
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
    </div>
  );
} 
