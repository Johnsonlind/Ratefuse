// ==========================================
// 用户菜单/入口组件
// ==========================================
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../modules/auth/AuthContext';
import { AuthModal } from '../../modules/auth/AuthModal';
import { useNavigate } from 'react-router-dom';
import { Dialog } from './Dialog';
import { Input } from './Input';
import { Textarea } from './Textarea';
import { Button } from './Button';
import { toast } from 'sonner';
import { authFetch } from '../../api/authFetch';
import { MEMBERSHIP_ENABLED } from '../../config/features';

export function UserButton() {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showCookieDialog, setShowCookieDialog] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [cookieValue, setCookieValue] = useState('');
  const [hasCookie, setHasCookie] = useState(false);
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackImages, setFeedbackImages] = useState<FileList | null>(null);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const avatarImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = avatarImgRef.current;
    if (!img) return;
    img.style.visibility = 'visible';
    img.dataset.retryAvatar = '0';
  }, [user?.id, user?.avatar]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  const handleClick = () => {
    if (user) {
      setShowDropdown(!showDropdown);
    } else {
      setShowAuthModal(true);
    }
  };

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
  };

  const handleOpenFeedbackDialog = () => {
    setShowFeedbackDialog(true);
    setShowDropdown(false);
  };

  const handleJoinMember = async () => {
    try {
      const res = await authFetch('/api/member/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'month', channel: 'wechat' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || '开通失败');
      }
      toast.success('会员开通成功');
      navigate('/profile');
      setShowDropdown(false);
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message || '开通会员失败');
    }
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackContent.trim()) {
      toast.error('请填写反馈内容');
      return;
    }
    setSubmittingFeedback(true);
    try {
      const formData = new FormData();
      formData.append('content', feedbackContent.trim());
      if (feedbackTitle.trim()) formData.append('title', feedbackTitle.trim());
      if (feedbackImages) {
        Array.from(feedbackImages).forEach((file) => formData.append('images', file));
      }
      const res = await authFetch('/api/feedbacks', { method: 'POST', body: formData } as any);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || '提交失败');
      }
      toast.success('反馈已提交');
      setShowFeedbackDialog(false);
      setFeedbackTitle('');
      setFeedbackContent('');
      setFeedbackImages(null);
    } catch (e: any) {
      toast.error(e?.message || '提交失败');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetch('/api/user/douban-cookie', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      })
        .then(res => res.json())
        .then(data => {
          setHasCookie(data.has_cookie || false);
        })
        .catch(() => {});
    }
  }, [user]);

  const handleOpenCookieDialog = () => {
    setShowCookieDialog(true);
    setShowDropdown(false);
  };

  const handleSaveCookie = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/user/douban-cookie', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ cookie: cookieValue })
      });

      if (response.ok) {
        const data = await response.json();
        setHasCookie(data.has_cookie);
        toast.success(data.message || '豆瓣Cookie保存成功');
        setShowCookieDialog(false);
        setCookieValue('');
      } else {
        const error = await response.json();
        toast.error(error.detail || '保存失败');
      }
    } catch (error) {
      toast.error('保存失败，请重试');
    }
  };

  const handleClearCookie = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/user/douban-cookie', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ cookie: '' })
      });

      if (response.ok) {
        const data = await response.json();
        setHasCookie(data.has_cookie);
        toast.success(data.message || '豆瓣Cookie已清除');
        setShowCookieDialog(false);
        setCookieValue('');
      } else {
        const error = await response.json();
        toast.error(error.detail || '清除失败');
      }
    } catch (error) {
      toast.error('清除失败，请重试');
    }
  };

  const getDropdownPosition = () => {
    if (!buttonRef.current) return { top: 0, right: 0 };
    const rect = buttonRef.current.getBoundingClientRect();
    return {
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    };
  };

  return (
    <>
      <div className="relative z-[100]">
        <button
          ref={buttonRef}
          onClick={handleClick}
          className="w-7 h-7 flex items-center justify-center rounded-full glass-button transition-all duration-200 hover:scale-110"
          aria-label={user ? '个人中心' : '登录'}
          aria-haspopup={user ? 'menu' : 'dialog'}
          aria-expanded={user ? showDropdown : showAuthModal}
          aria-controls={user ? 'user-menu' : undefined}
        >
        <img 
          ref={avatarImgRef}
          key={`${user?.id ?? 0}:${user?.avatar ?? 'default'}`}
          src={user?.avatar || '/Profile.png'} 
          alt="用户头像"
          className="w-5 h-5 rounded-full"
          loading="eager"
          decoding="async"
          fetchPriority="high"
          style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
          onError={(e) => {
            const img = e.currentTarget;
            try {
              const raw = user?.avatar;
              if (!raw) return;
              const tries = Number(img.dataset.retryAvatar || '0');
              if (tries >= 3) {
                img.src = '/Profile.png';
                img.dataset.retryAvatar = '';
                return;
              }
              img.dataset.retryAvatar = String(tries + 1);
              const hasQuery = raw.includes('?');
              img.src = `${raw}${hasQuery ? '&' : '?'}cb=${Date.now()}_${tries + 1}`;
            } catch {
            }
          }}
          onLoad={(e) => {
            const img = e.currentTarget;
            img.style.visibility = 'visible';
          }}
        />
        </button>
      </div>

      {user && showDropdown && createPortal(
        <div 
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: `${getDropdownPosition().top}px`,
            right: `${getDropdownPosition().right}px`,
            zIndex: 1000,
          }}
          className="w-40 rounded-lg glass-dropdown"
          id="user-menu"
          role="menu"
          aria-label="用户菜单"
        >
          <div className="py-1">
            <button
              onClick={() => {
                navigate('/profile');
                setShowDropdown(false);
              }}
              className="block w-full text-left px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-200/80 active:bg-gray-200/80 dark:hover:bg-white/10 dark:active:bg-white/10 focus:bg-gray-200/80 dark:focus:bg-white/10 rounded transition-colors"
              role="menuitem"
            >
              个人中心
            </button>
            {user.is_admin && (
              <button
                onClick={() => {
                  navigate('/admin');
                  setShowDropdown(false);
                }}
                className="block w-full text-left px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-200/80 active:bg-gray-200/80 dark:hover:bg-white/10 dark:active:bg-white/10 focus:bg-gray-200/80 dark:focus:bg-white/10 rounded transition-colors"
                role="menuitem"
              >
                管理后台
              </button>
            )}
            {MEMBERSHIP_ENABLED && (
              <button
                onClick={() => {
                  if (user?.is_member) {
                    navigate('/profile');
                    setShowDropdown(false);
                    return;
                  }
                  void handleJoinMember();
                }}
                className="block w-full text-left px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-200/80 active:bg-gray-200/80 dark:hover:bg-white/10 dark:active:bg-white/10 focus:bg-gray-200/80 dark:focus:bg-white/10 rounded transition-colors"
                role="menuitem"
              >
                {user?.is_member ? '已是会员' : '加入会员'}
              </button>
            )}
            <button
              onClick={handleOpenFeedbackDialog}
              className="block w-full text-left px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-200/80 active:bg-gray-200/80 dark:hover:bg-white/10 dark:active:bg-white/10 focus:bg-gray-200/80 dark:focus:bg-white/10 rounded transition-colors"
              role="menuitem"
            >
              提交反馈
            </button>
            <button
              onClick={handleOpenCookieDialog}
              className="block w-full text-left px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-200/80 active:bg-gray-200/80 dark:hover:bg-white/10 dark:active:bg-white/10 focus:bg-gray-200/80 dark:focus:bg-white/10 rounded transition-colors"
              role="menuitem"
            >
              {hasCookie ? '✓ 豆瓣Cookie' : '设置豆瓣Cookie'}
            </button>
            <button
              onClick={handleLogout}
              className="block w-full text-left px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-200/80 active:bg-gray-200/80 dark:hover:bg-white/10 dark:active:bg-white/10 focus:bg-gray-200/80 dark:focus:bg-white/10 rounded transition-colors"
              role="menuitem"
            >
              退出登录
            </button>
          </div>
        </div>,
        document.body
      )}

      <Dialog
        open={showFeedbackDialog}
        onClose={() => {
          setShowFeedbackDialog(false);
          setFeedbackTitle('');
          setFeedbackContent('');
          setFeedbackImages(null);
        }}
        title="提交反馈"
      >
        <div className="space-y-4">
          <Input
            placeholder="反馈标题（可选）"
            value={feedbackTitle}
            onChange={(e) => setFeedbackTitle(e.target.value)}
          />
          <Textarea
            placeholder="请描述你遇到的问题或建议（必填）"
            rows={5}
            value={feedbackContent}
            onChange={(e) => setFeedbackContent(e.target.value)}
          />
          <div>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => setFeedbackImages(e.target.files)}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 file:transition-colors file:cursor-pointer"
            />
            <p className="mt-1 text-xs text-gray-400">支持多张图片，每张不超过 5MB</p>
          </div>
          <div className="modal-actions flex justify-end gap-2 pt-2 pl-6 pr-6">
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={() => {
                setShowFeedbackDialog(false);
                setFeedbackTitle('');
                setFeedbackContent('');
                setFeedbackImages(null);
              }}
            >
              取消
            </Button>
            <Button
              className="cursor-pointer"
              disabled={submittingFeedback || !feedbackContent.trim()}
              onClick={handleSubmitFeedback}
            >
              {submittingFeedback ? '提交中...' : '提交反馈'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={showCookieDialog}
        onClose={() => {
          setShowCookieDialog(false);
          setCookieValue('');
        }}
        title="设置豆瓣Cookie"
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <p className="mb-2 font-medium">获取Cookie的流程：</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>打开浏览器，访问 <span className="font-mono text-xs">douban.com</span> 并登录</li>
              <li>按 <span className="font-mono text-xs">F12</span> 或右键选择"检查"打开开发者工具</li>
              <li>切换到 <span className="font-mono text-xs">Network</span>（网络）标签</li>
              <li>刷新页面，找到以 <span className="font-mono text-xs">douban.com</span> 结尾的请求</li>
              <li>点击该请求，在 <span className="font-mono text-xs">Headers</span>（请求头）中找到 <span className="font-mono text-xs">Cookie</span> 字段</li>
              <li>复制完整的Cookie值（从第一个键值对到最后一个）并粘贴到下方</li>
            </ol>
            <div className="mt-3 p-2 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono break-all">
              <p className="text-gray-500 dark:text-gray-400 mb-1">Cookie示例格式：</p>
              <p className="text-gray-700 dark:text-gray-300">bid=xxx; dbcl2="xxx"; ck=xxx; ...</p>
            </div>
          </div>
          
          <Textarea
            placeholder="粘贴您的豆瓣Cookie（例如：bid=xxx; dbcl2=xxx; ...）"
            value={cookieValue}
            onChange={(e) => setCookieValue(e.target.value)}
            className="text-sm min-h-[80px]"
            rows={3}
          />
          
          <div className="modal-actions flex gap-2 pt-2 pl-6 pr-6">
            <Button
              onClick={handleSaveCookie}
              className="flex-1"
              disabled={!cookieValue.trim()}
            >
              保存
            </Button>
            {hasCookie && (
              <Button
                onClick={handleClearCookie}
                variant="outline"
                className="flex-1"
              >
                清除
              </Button>
            )}
            <Button
              onClick={() => {
                setShowCookieDialog(false);
                setCookieValue('');
              }}
              variant="outline"
            >
              取消
            </Button>
          </div>
          
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            建议每7-14天更换一次Cookie，以确保正常使用
          </p>
        </div>
      </Dialog>

      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
      />
    </>
  );
}
