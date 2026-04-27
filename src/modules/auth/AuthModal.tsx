// ==========================================
// 登录/认证弹窗组件
// ==========================================
import { useState, useEffect, useRef } from 'react';
import { Dialog } from '@headlessui/react';
import { useAuth } from './AuthContext';
import { X } from 'lucide-react';
import { toast } from 'sonner';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'login' | 'register';
}

export function AuthModal({ isOpen, onClose, initialMode = 'login' }: AuthModalProps) {
  const [isLogin, setIsLogin] = useState(initialMode !== 'register');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  
  const { login, register, sendPasswordResetEmail } = useAuth();
  const submitLock = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsLogin(initialMode !== 'register');
  }, [isOpen, initialMode]);

  useEffect(() => {
    const theme = document.documentElement.getAttribute('data-theme');
    setIsDark(theme === 'dark');

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          const newTheme = document.documentElement.getAttribute('data-theme');
          setIsDark(newTheme === 'dark');
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    return () => observer.disconnect();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setError('');
    setIsLoading(true);

    try {
      if (isLogin) {
        await login(email, password, rememberMe);
      } else {
        await register(email, username, password);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setIsLoading(false);
      submitLock.current = false;
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('请输入邮箱地址');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入有效的邮箱地址');
      return;
    }

    setError('');
    setIsLoading(true);
    
    try {
      await sendPasswordResetEmail(email);
      toast.success('重置密码链接已发送到您的邮箱，请查收');
      onClose();
    } catch (err) {
      console.error('Reset password error:', err);
      const errorMessage = err instanceof Error ? err.message : '发送重置邮件失败';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="modal-root fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="modal-card auth-modal-panel w-full max-w-[320px] sm:max-w-[420px] overflow-hidden rounded-3xl border border-white/25 bg-white/18 backdrop-blur-xl shadow-none">
          <div className="relative overflow-hidden">
            <div
              className="absolute inset-0 backdrop-blur-md"
              style={{
                background: isDark 
                  ? 'linear-gradient(to bottom right, rgba(17, 25, 40, 0.62), rgba(30, 41, 59, 0.56), rgba(51, 65, 85, 0.52))'
                  : 'linear-gradient(to bottom right, rgba(255, 255, 255, 0.5), rgba(248, 250, 252, 0.44), rgba(226, 232, 240, 0.42))'
              }}
            />
            
            <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-[#2780b3]/30 blur-2xl"></div>
            <div className="absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-[#c9b9cc]/30 blur-2xl"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-[#87a1c2]/20 blur-xl"></div>
            
            <div className="relative z-20 pt-8 pb-8 px-4 sm:px-8">
              <div className="flex justify-between items-start">
                <Dialog.Title className="text-2xl sm:text-3xl font-bold text-white">
                  {isLogin ? '登录' : '注册'}
                </Dialog.Title>
                <button 
                  onClick={onClose} 
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              </div>
              
              <div className="mt-6">
                <form id="loginForm" onSubmit={handleSubmit} className="space-y-3">
                  {!isLogin && (
                    <div>
                      <input
                        type="text"
                        required
                        placeholder="用户名"
                        value={username}
                        disabled={isLoading}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full px-4 py-2 text-sm sm:text-base rounded-lg border border-white/30 outline-none
                          bg-white/20 text-black dark:text-white placeholder-gray-500 dark:placeholder-white/60 focus:border-transparent focus:ring-0"
                      />
                    </div>
                  )}

                  <div>
                    <input
                      type="email"
                      required
                      placeholder="邮箱"
                      value={email}
                      disabled={isLoading}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-2 text-sm sm:text-base rounded-lg border border-white/30 outline-none
                        bg-white/20 text-black dark:text-white placeholder-gray-500 dark:placeholder-white/60 focus:border-transparent focus:ring-0"
                    />
                  </div>

                  <div>
                    <input
                      type="password"
                      required
                      placeholder="密码"
                      value={password}
                      disabled={isLoading}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-4 py-2 text-sm sm:text-base rounded-lg border border-white/30 outline-none
                        bg-white/20 text-black dark:text-white placeholder-gray-500 dark:placeholder-white/60 focus:border-transparent focus:ring-0"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        disabled={isLoading}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="mr-2 rounded border-white/30 bg-white/10"
                      />
                      <span className="text-xs sm:text-sm text-white/70">
                        记住我
                      </span>
                    </label>
                    
                    {isLogin && (
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={isLoading}
                        className="text-xs sm:text-sm text-white/70 hover:text-white transition-colors"
                      >
                        忘记密码？
                      </button>
                    )}
                  </div>

                  {error && (
                    <div className="text-red-300 text-sm">
                      {error}
                    </div>
                  )}
                </form>

                <div className="mt-6 flex justify-between items-center">
                  <div className="text-xs sm:text-sm text-white/70">
                    {isLogin ? (
                      <p>
                        没有账号？{' '}
                        <button
                          type="button"
                          onClick={() => setIsLogin(false)}
                          className="text-white hover:underline transition-all"
                        >
                          点击注册
                        </button>
                      </p>
                    ) : (
                      <p>
                        已有账号？{' '}
                        <button
                          type="button"
                          onClick={() => setIsLogin(true)}
                          className="text-white hover:underline transition-all"
                        >
                          点击登录
                        </button>
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    form="loginForm"
                    disabled={isLoading}
                    className="px-6 py-2 text-sm sm:text-base rounded-lg bg-white/20 text-white font-medium hover:bg-white/30 disabled:opacity-50 transition-all"
                  >
                    {isLoading ? '处理中...' : (isLogin ? '登录' : '注册')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
