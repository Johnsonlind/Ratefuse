// ==========================================
// 当前用户资料页
// ==========================================
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../modules/auth/AuthContext';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { getBase64Image } from '../api/image';
import { Dialog } from '../shared/ui/Dialog';
import { Input } from '../shared/ui/Input';
import { Textarea } from '../shared/ui/Textarea';
import { Button } from '../shared/ui/Button';
import { Switch } from '../shared/ui/Switch';
import { toast } from "sonner";
import { ConfirmDialog } from '../shared/ui/ConfirmDialog';
import { CardTabs } from '../shared/ui/CardTabs';
import { PageShell } from '../modules/layout/PageShell';
import { usePageMeta } from '../shared/hooks/usePageMeta';
import { authFetch, authFetchJson } from '../api/authFetch';
import { formatChinaDate, formatChinaDateTime } from '../shared/utils/time';

const formatChinaTime = (value?: string | null) => formatChinaDateTime(value);

interface Creator {
  id: number;
  username: string;
  avatar: string;
  is_following?: boolean;
}

interface Favorite {
  id: number;
  media_id: string;
  media_type: string;
  title: string;
  poster: string;
  year?: string;
  overview?: string;
  sort_order?: number | null;
}

interface FavoriteList {
  id: number;
  name: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
  updated_at?: string;
  favorites: Favorite[];
  original_list_id?: number;
  original_creator?: Creator;
  creator?: Creator;
}

interface ProfileFormData {
  username: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface Following {
  id: number;
  username: string;
  avatar: string;
  note: string | null;
  created_at: string;
}

const useElementSize = () => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!elementRef.current) return;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });

    observer.observe(elementRef.current);
    return () => observer.disconnect();
  }, []);

  return { elementRef, ...size };
};

export default function ProfilePage() {
  const { user, isLoading, updateUserInfo, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<ProfileFormData>({
    username: user?.username || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(null);
  const [lists, setLists] = useState<FavoriteList[]>([]);
  const [editingList, setEditingList] = useState<FavoriteList | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newList, setNewList] = useState({
    name: '',
    description: '',
    is_public: false
  });
  const [activeTab, setActiveTab] = useState<'collections' | 'following' | 'feedbacks'>('collections');
  const [following, setFollowing] = useState<Following[]>([]);
  const [showNoteDialog, setShowNoteDialog] = useState(false);
  const [editingFollow, setEditingFollow] = useState<Following | null>(null);
  const [isLoadingLists, setIsLoadingLists] = useState(true);
  const [listsLoadError, setListsLoadError] = useState<string | null>(null);
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(true);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [confirmDeleteList, setConfirmDeleteList] = useState<FavoriteList | null>(null);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [isLoadingFeedbacks, setIsLoadingFeedbacks] = useState(false);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackImages, setFeedbackImages] = useState<FileList | null>(null);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [activeFeedbackId, setActiveFeedbackId] = useState<number | null>(null);
  const [isLoadingFeedbackDetail, setIsLoadingFeedbackDetail] = useState(false);
  const [activeFeedbackReply, setActiveFeedbackReply] = useState('');
  const [isReplyingFeedback, setIsReplyingFeedback] = useState(false);
  const [isResolvingFeedback, setIsResolvingFeedback] = useState(false);
  const [pendingDeleteFeedbackId, setPendingDeleteFeedbackId] = useState<number | null>(null);
  const [pendingUnfollowId, setPendingUnfollowId] = useState<number | null>(null);
  const activeFeedbackChatRef = useRef<HTMLDivElement | null>(null);

  usePageMeta({
    title: user ? `${user.username} 的个人中心 - RateFuse` : '个人中心 - RateFuse',
    description: '管理个人资料、创建与分享片单、查看关注列表。',
    canonicalPath: '/profile',
  });

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/');
    }
  }, [user, isLoading, navigate]);

  useEffect(() => {
    const tab = (searchParams.get('tab') || '').trim();
    const fidRaw = (searchParams.get('feedback_id') || '').trim();
    const fid = fidRaw ? Number(fidRaw) : NaN;

    if (tab === 'feedbacks') {
      setActiveTab('feedbacks');
      if (!Number.isNaN(fid) && fid > 0) {
        setActiveFeedbackId(fid);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    const fetchFavorites = async () => {
      try {
        const response = await authFetch('/api/favorites');
        if (response.ok) {
          await response.json();
        }
      } catch (error) {
        console.error('获取收藏列表失败:', error);
      }
    };

    if (user) {
      fetchFavorites();
    }
  }, [user]);

  useEffect(() => {
    const fetchFeedbacks = async () => {
      if (!user) return;
      setIsLoadingFeedbacks(true);
      try {
        const res = await authFetch('/api/feedbacks');
        if (res.ok) {
          const data = await res.json();
          setFeedbacks(data);
        }
      } catch (err) {
        console.error('获取反馈列表失败:', err);
      } finally {
        setIsLoadingFeedbacks(false);
      }
    };

    if (user) {
      fetchFeedbacks();
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (activeTab !== 'feedbacks') return;

    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await authFetch('/api/feedbacks');
        if (!res.ok) return;
        const data = await res.json();
        setFeedbacks((prev) => {
          const prevById = new Map<number, any>(prev.map((x) => [x.id, x]));
          return (data || []).map((x: any) => {
            const old = prevById.get(x.id);
            return old && old.messages ? { ...x, messages: old.messages } : x;
          });
        });
      } catch {
      }
    };

    const schedule = () => {
      timer = window.setInterval(tick, 8000);
    };

    tick();
    schedule();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, activeTab]);

  useEffect(() => {
    if (!user) return;
    if (activeTab !== 'feedbacks') return;
    if (!activeFeedbackId) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      try {
        const detail = await authFetchJson<any>(`/api/feedbacks/${activeFeedbackId}`);
        setFeedbacks((prev) => prev.map((f) => (f.id === activeFeedbackId ? detail : f)));
      } catch {
      }
    };

    tick();
    const timer = window.setInterval(tick, 6000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, activeTab, activeFeedbackId]);

  useEffect(() => {
    if (activeTab !== 'feedbacks') return;
    if (!activeFeedbackId) return;
    const fb = feedbacks.find((f) => f.id === activeFeedbackId);
    const len = fb?.messages?.length || 0;
    if (!len) return;
    const el = activeFeedbackChatRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [activeTab, activeFeedbackId, feedbacks]);

  const fetchLists = async () => {
    setIsLoadingLists(true);
    setListsLoadError(null);
    const maxAttempts = 3;

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await authFetch(`/api/favorite-lists/light?_=${Date.now()}`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const data = await response.json();
          setLists(Array.isArray(data) ? data : []);
          setListsLoadError(null);
          return;
        } catch (error) {
          if (attempt === maxAttempts) throw error;
          await new Promise((resolve) => window.setTimeout(resolve, attempt * 400));
        }
      }
    } catch (error) {
      console.error('获取收藏列表失败:', error);
      setListsLoadError('收藏列表加载失败，请稍后重试');
    } finally {
      setIsLoadingLists(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchLists();
    } else {
      setIsLoadingLists(false);
      setListsLoadError(null);
      setLists([]);
    }
  }, [user]);

  useEffect(() => {
    const fetchFollowing = async () => {
      try {
        const response = await authFetch('/api/users/me/following');
        if (response.ok) {
          const data = await response.json();
          setFollowing(data);
        }
      } catch (error) {
        console.error('获取关注列表失败:', error);
      } finally {
        setIsLoadingFollowing(false);
      }
    };

    if (user) {
      fetchFollowing();
    }
  }, [user]);

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const base64 = await getBase64Image(file);
      setPreviewAvatar(base64);
      
      const response = await authFetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          avatar: base64
        })
      });

      if (!response.ok) {
        throw new Error('头像更新失败');
      }

      const data = await response.json();
      updateUserInfo(data.user);
      setSuccess('头像更新成功');
    } catch (error) {
      console.error('头像处理失败:', error);
      setError('头像上传失败');
    }
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackContent.trim()) {
      toast.error('请填写反馈内容');
      return;
    }
    setIsSubmittingFeedback(true);
    try {
      const formData = new FormData();
      formData.append('content', feedbackContent.trim());
      if (feedbackTitle.trim()) {
        formData.append('title', feedbackTitle.trim());
      }
      if (feedbackImages) {
        Array.from(feedbackImages).forEach((file) => {
          formData.append('images', file);
        });
      }
      const res = await authFetch('/api/feedbacks', {
        method: 'POST',
        body: formData,
        headers: {
        } as any,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || '提交失败');
      }
      const created = await res.json();
      setFeedbacks((prev) => [created, ...prev]);
      setFeedbackContent('');
      setFeedbackTitle('');
      setFeedbackImages(null);
      toast.success('反馈已提交');
    } catch (err: any) {
      console.error('提交反馈失败:', err);
      toast.error(err?.message || '提交失败');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleSelectFeedback = async (id: number) => {
    if (activeFeedbackId === id) {
      setActiveFeedbackId(null);
      setActiveFeedbackReply('');
      return;
    }
    setActiveFeedbackId(id);
    setActiveFeedbackReply('');

    const target = feedbacks.find((f) => f.id === id);
    if (target && target.messages && Array.isArray(target.messages)) {
      return;
    }

    setIsLoadingFeedbackDetail(true);
    try {
      const detail = await authFetchJson<any>(`/api/feedbacks/${id}`);
      setFeedbacks((prev) => prev.map((f) => (f.id === id ? detail : f)));
    } catch (err) {
      console.error('获取反馈详情失败:', err);
      toast.error('获取反馈详情失败');
    } finally {
      setIsLoadingFeedbackDetail(false);
    }
  };

  const handleReplyFeedback = async (id: number) => {
    const content = activeFeedbackReply.trim();
    if (!content) return;
    setIsReplyingFeedback(true);
    try {
      const detail = await authFetchJson<any>(`/api/feedbacks/${id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });
      setFeedbacks((prev) => prev.map((f) => (f.id === id ? detail : f)));
      setActiveFeedbackReply('');
      toast.success('已发送追加消息');
    } catch (err: any) {
      console.error('追加消息失败:', err);
      toast.error(err?.message || '追加消息失败');
    } finally {
      setIsReplyingFeedback(false);
    }
  };

  const handleResolveFeedback = async (id: number) => {
    setIsResolvingFeedback(true);
    try {
      const updated = await authFetchJson<any>(`/api/feedbacks/${id}/resolve`, {
        method: 'POST',
      });
      setFeedbacks((prev) => prev.map((f) => (f.id === id ? { ...f, ...updated } : f)));
      toast.success('已标记为已解决（等待管理员确认关闭）');
    } catch (err: any) {
      console.error('标记已解决失败:', err);
      toast.error(err?.message || '标记已解决失败');
    } finally {
      setIsResolvingFeedback(false);
    }
  };

  const handleDeleteFeedback = async (id: number) => {
    try {
      const res = await authFetch(`/api/feedbacks/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || '删除失败');
      }
      setFeedbacks((prev) => prev.filter((f) => f.id !== id));
      if (activeFeedbackId === id) setActiveFeedbackId(null);
      toast.success('已删除反馈');
    } catch (err: any) {
      console.error('删除反馈失败:', err);
      toast.error(err?.message || '删除失败');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      const updateData: any = {};
      
      if (formData.username !== user?.username) {
        updateData.username = formData.username;
      }

      if (previewAvatar) {
        updateData.avatar = previewAvatar;
      }

      if (formData.newPassword) {
        if (formData.newPassword !== formData.confirmPassword) {
          setError('两次输入的新密码不一致');
          return;
        }
        updateData.password = formData.newPassword;
      }

      const response = await authFetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.detail || '更新失败');
      }

      updateUserInfo(data.user);
      setSuccess('个人资料更新成功');
      setIsEditing(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : '更新失败');
    }
  };

  const handleEditList = async (list: FavoriteList) => {
    try {
      const response = await authFetch(`/api/favorite-lists/${list.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: list.name,
          description: list.description,
          is_public: list.is_public
        })
      });

      if (response.ok) {
        const updatedList = await response.json();
        setLists(lists.map(l => l.id === updatedList.id ? updatedList : l));
        setShowEditDialog(false);
        setEditingList(null);
      }
    } catch (error) {
      console.error('更新收藏列表失败:', error);
    }
  };

  const handleDeleteList = async (listId: number) => {
    const target = lists.find(l => l.id === listId) || null;
    setConfirmDeleteList(target);
  };

  const confirmDeleteListNow = async () => {
    if (!confirmDeleteList) return;
    try {
      const response = await authFetch(`/api/favorite-lists/${confirmDeleteList.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setLists(lists.filter(l => l.id !== confirmDeleteList.id));
        toast.success('已删除');
        setConfirmDeleteList(null);
      }
    } catch (error) {
      console.error('删除收藏列表失败:', error);
      toast.error('删除失败');
    }
  };

  const handleCreateList = async () => {
    try {
      const response = await authFetch('/api/favorite-lists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newList)
      });

      if (response.ok) {
        const createdList = await response.json();
        setLists([...lists, createdList]);
        setShowCreateDialog(false);
        setNewList({ name: '', description: '', is_public: false });
      }
    } catch (error) {
      console.error('创建收藏列表失败:', error);
    }
  };

  const FavoriteListCard = ({ list }: { list: FavoriteList }) => {
    const { elementRef, width } = useElementSize();
    const posterWidth = width < 300 ? 80 : 100;
    const posterGap = width < 300 ? 20 : 30;
    const rightMargin = 4;

    const getSortedFavorites = (favorites: Favorite[]) => {
      if (favorites.some(f => f.sort_order !== null)) {
        return [...favorites].sort((a, b) => 
          (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
        );
      }
      return [...favorites].sort((a, b) => a.id - b.id);
    };

    const calculatePostersToShow = (containerWidth: number) => {
      if (containerWidth <= 0) return 0;
      const availableWidth = containerWidth - rightMargin;
      return Math.max(2, Math.floor((availableWidth - posterWidth) / posterGap) + 1);
    };

    const postersToShow = width > 0 ? calculatePostersToShow(width) : 0;
    const sortedFavorites = getSortedFavorites(list.favorites);
    const favoritesToShow = sortedFavorites.slice(0, postersToShow);

    return (
      <div ref={elementRef} className="glass-card rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow h-full">
        <div className="flex flex-col h-full">
          {/* 海报堆叠展示区域 */}
          <Link 
            to={`/favorite-lists/${list.id}`}
            className="relative h-[160px] flex items-start cursor-pointer"
          >
            {width > 0 && favoritesToShow.map((favorite, index) => (
              <div
                key={favorite.id}
                className="absolute"
                style={{
                  top: 0,
                  left: `${index * posterGap}px`,
                  zIndex: postersToShow - index,
                  filter: `brightness(${100 - (postersToShow - index - 1) * 1.5}%)`,
                }}
              >
                <div 
                  className={`
                    ${width < 300 ? 'w-[80px] h-[120px]' : 'w-[100px] h-[150px]'}
                    rounded-lg overflow-hidden
                    relative
                    before:content-['']
                    before:absolute
                    before:inset-0
                    before:z-10
                    before:shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]
                    before:pointer-events-none
                  `}
                  style={{
                    boxShadow: index === 0 
                      ? `
                        0 4px 6px rgba(0,0,0,0.2),
                        0 6px 10px rgba(0,0,0,0.15),
                        inset 0 0 2px rgba(0,0,0,0.2)
                      `
                      : index === 1
                      ? `
                        0 3px 5px rgba(0,0,0,0.18),
                        0 5px 8px rgba(0,0,0,0.12),
                        inset 0 0 2px rgba(0,0,0,0.2)
                      `
                      : `
                        ${4 + index}px ${4 + index}px 6px rgba(0,0,0,0.15),
                        0 ${2 + index}px ${4 + index}px rgba(0,0,0,0.1),
                        inset 0 0 2px rgba(0,0,0,0.2)
                      `,
                    transform: 'none'
                  }}
                >
                  <div 
                    className="absolute inset-0 z-10 pointer-events-none"
                    style={{
                      background: `
                        linear-gradient(
                          to bottom,
                          rgba(0,0,0,0.1) 0%,
                          rgba(0,0,0,0) 20%,
                          rgba(0,0,0,0) 80%,
                          rgba(0,0,0,0.2) 100%
                        )
                      `
                    }}
                  />

                  <div 
                    className="absolute inset-0 z-20 pointer-events-none rounded-lg"
                    style={{
                      boxShadow: index < 2
                        ? 'inset 0 1px 4px rgba(0,0,0,0.25), inset 0 0 2px rgba(0,0,0,0.15)'
                        : 'inset 0 1px 3px rgba(0,0,0,0.2), inset 0 0 2px rgba(0,0,0,0.1)'
                    }}
                  />

                  <img
                    src={favorite.poster}
                    alt={favorite.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              </div>
            ))}
            {sortedFavorites.length > postersToShow && (
              <div 
                className="absolute flex items-center justify-center text-gray-500"
                style={{
                  left: `${postersToShow * posterGap + 10}px`,
                  zIndex: 0
                }}
              >
                +{sortedFavorites.length - postersToShow}
              </div>
            )}
          </Link>

          {/* 列表信息 */}
          <div className="mb-4">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-medium truncate">
                  <Link to={`/favorite-lists/${list.id}`} className="hover:text-blue-500">
                    {list.name}
                  </Link>
                </h3>
                {!list.is_public && (
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" 
                    />
                  </svg>
                )}
              </div>
            </div>
            {list.description && (
              <p className="text-gray-700 dark:text-gray-300 text-sm mt-1 line-clamp-2">
                {list.description}
              </p>
            )}
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              {list.favorites.length} 部作品
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {formatChinaDate(list.created_at)}
            </p>
          </div>

          {/* 底部信息区域 */}
          <div className="mt-auto pt-4 flex justify-between items-end">
            {/* 创建者信息 */}
            <div className="flex items-center gap-2">
              {list.original_list_id && list.original_creator ? (
                <>
                  <img
                    src={list.original_creator?.avatar || '/default-avatar.png'}
                    alt={list.original_creator?.username}
                    className="w-6 h-6 rounded-full object-cover cursor-pointer"
                    onClick={() => navigate(`/profile/${list.original_creator?.id}`)}
                  />
                    <span 
                    className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-500"
                    onClick={() => navigate(`/profile/${list.original_creator?.id}`)}
                  >
                    {list.original_creator?.username}
                  </span>
                </>
              ) : (
                <>
                  <img
                    src={user?.avatar || '/default-avatar.png'}
                    alt={user?.username}
                    className="w-6 h-6 rounded-full object-cover"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {user?.username}
                  </span>
                </>
              )}
            </div>
            
            {/* 编辑、删除和分享按钮 */}
            <div className="flex gap-1">
              {list.is_public && (
                <button
                  onClick={() => {
                    const shareUrl = `${window.location.origin}/favorite-lists/${list.id}`;
                    navigator.clipboard.writeText(shareUrl)
                      .then(() => {
                        toast.success("链接已复制到剪贴板");
                      })
                      .catch(() => {
                        toast.error("复制链接失败");
                      });
                  }}
                    className="p-1 text-gray-600 dark:text-gray-300 hover:text-blue-600"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => {
                  setEditingList(list);
                  setShowEditDialog(true);
                }}
                className="p-1 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
              <button
                onClick={() => handleDeleteList(list.id)}
                className="p-1 text-gray-600 dark:text-gray-300 hover:text-red-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handleUnfollow = async (userId: number) => {
    try {
      const response = await authFetch(`/api/users/${userId}/follow`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setFollowing(following.filter(f => f.id !== userId));
        toast.success('取消关注成功');
      }
    } catch (error) {
      console.error('取消关注失败:', error);
      toast.error('操作失败');
    }
  };

  const handleUnfollowClick = (userId: number) => {
    setPendingUnfollowId(userId);
  };

  const handleUpdateNote = async () => {
    if (!editingFollow) return;

    try {
      const response = await authFetch(`/api/users/${editingFollow.id}/follow/note`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          note: editingFollow.note
        })
      });

      if (response.ok) {
        setFollowing(following.map(f =>
          f.id === editingFollow.id ? editingFollow : f
        ));
        setShowNoteDialog(false);
        setEditingFollow(null);
        toast.success('更新备注成功');
      }
    } catch (error) {
      console.error('更新备注失败:', error);
      toast.error('操作失败');
    }
  };

  if (isLoading || !user) {
    return (
      <PageShell maxWidth="4xl" contentClassName="flex items-center justify-center py-12">
        <div className="text-gray-600 dark:text-gray-400">加载中...</div>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="4xl" contentClassName="py-3">
          {/* 个人资料卡片 */}
          <div className="glass-card rounded-2xl p-8 mb-8">
            <form onSubmit={handleSubmit}>
              <div className="flex items-center gap-6">
                {/* 头像区域 */}
                <div className="relative">
                  <img
                    src={previewAvatar || user?.avatar || '/Profile.png'}
                    alt="用户头像"
                    className="w-24 h-24 rounded-full object-cover border-4 border-white"
                    loading="lazy"
                  />
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleAvatarUpload}
                    accept="image/*"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute bottom-0 right-0 bg-blue-500 text-white p-2 rounded-full hover:bg-blue-600 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                </div>
                
                {/* 用户信息 */}
                <div className="flex-1">
                  {isEditing ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                          用户名
                        </label>
                        <input
                          type="text"
                          value={formData.username}
                          onChange={(e) => setFormData(prev => ({...prev, username: e.target.value}))}
                          className="mt-1 block w-full rounded-md border-2 border-gray-400 dark:border-gray-600 
                            glass-dropdown 
                            shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 
                            text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                          新密码
                        </label>
                        <input
                          type="password"
                          value={formData.newPassword}
                          onChange={(e) => setFormData(prev => ({...prev, newPassword: e.target.value}))}
                          className="mt-1 block w-full rounded-md border-2 border-gray-400 dark:border-gray-600 
                            glass-dropdown 
                            shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 
                            text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                          确认新密码
                        </label>
                        <input
                          type="password"
                          value={formData.confirmPassword}
                          onChange={(e) => setFormData(prev => ({...prev, confirmPassword: e.target.value}))}
                          className="mt-1 block w-full rounded-md border-2 border-gray-400 dark:border-gray-600 
                            glass-dropdown 
                            shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 
                            text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      {error && (
                        <p className="text-red-500 text-sm">{error}</p>
                      )}
                      {success && (
                        <p className="text-green-500 text-sm">{success}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditing(false);
                            setFormData({
                              username: user.username,
                              currentPassword: '',
                              newPassword: '',
                              confirmPassword: ''
                            });
                            setError('');
                            setSuccess('');
                          }}
                          className="bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h1 className="text-2xl font-bold dark:text-white mb-2">{user?.username}</h1>
                      <p className="text-gray-600 dark:text-gray-300">{user?.email}</p>
                      <div className="mt-4 flex gap-4 items-center">
                        <button
                          type="button"
                          onClick={() => setIsEditing(true)}
                          className="text-blue-500 hover:text-blue-600"
                        >
                          编辑个人资料
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmLogoutOpen(true);
                          }}
                          className="text-red-500 hover:text-red-600"
                        >
                          退出登录
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </form>
          </div>

          {/* 收藏 / 关注 / 反馈 */}
          <div className="glass-card rounded-2xl p-8">
            <CardTabs
              tabs={[
                { id: 'collections', label: '我的收藏' },
                { id: 'following', label: '我的关注' },
                { id: 'feedbacks', label: '我的反馈' },
              ]}
              activeId={activeTab}
              onChange={(id) => setActiveTab(id as 'collections' | 'following' | 'feedbacks')}
            />

            {activeTab === 'collections' && (
              <div className="flex justify-end mt-4 mb-4">
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="p-2 text-gray-500 hover:text-blue-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title="创建收藏列表"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            )}
            
            {activeTab === 'collections' && (
              isLoadingLists ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="rounded-lg p-4 bg-gray-300 dark:bg-gray-600 h-64 animate-pulse"></div>
                  ))}
                </div>
              ) : listsLoadError ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 dark:text-gray-400 mb-4">{listsLoadError}</p>
                  <button
                    onClick={() => {
                      void fetchLists();
                    }}
                    className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
                  >
                    重新加载
                  </button>
                </div>
              ) : lists.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 dark:text-gray-400 mb-4">您还没有创建任何收藏列表</p>
                  <button
                    onClick={() => setShowCreateDialog(true)}
                    className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
                  >
                    创建第一个收藏列表
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {lists.map(list => (
                    <FavoriteListCard key={list.id} list={list} />
                  ))}
                </div>
              )
            )}

            {activeTab === 'following' && (
              <div className="mt-6 space-y-6 pt-2">
                {/* 我的关注 */}
                {isLoadingFollowing ? (
                  <div className="grid grid-cols-1 gap-4">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="bg-gray-300 dark:bg-gray-600 rounded-xl p-4 h-20 animate-pulse"></div>
                    ))}
                  </div>
                ) : following.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-gray-500 dark:text-gray-400">您还没有关注任何用户</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {following.map(follow => (
                      <div key={follow.id} className="glass-card rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-4">
                          <img
                            src={follow.avatar || '/default-avatar.png'}
                            alt={follow.username}
                            className="w-12 h-12 rounded-full object-cover cursor-pointer"
                            onClick={() => navigate(`/profile/${follow.id}`)}
                            loading="lazy"
                          />
                          <div className="flex-1">
                            <h3 
                              className="text-lg font-medium dark:text-white cursor-pointer hover:text-blue-500"
                              onClick={() => navigate(`/profile/${follow.id}`)}
                            >
                              {follow.username}
                            </h3>
                            {follow.note && (
                              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                {follow.note}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingFollow(follow);
                                setShowNoteDialog(true);
                              }}
                              className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleUnfollowClick(follow.id)}
                              className="p-2 text-gray-500 hover:text-red-600"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                                  d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'feedbacks' && (
              <div className="mt-6 space-y-6">
                <form onSubmit={handleFeedbackSubmit} className="hidden space-y-4">
                  <div className="grid gap-3">
                    <Input
                      placeholder="反馈标题（可选）"
                      value={feedbackTitle}
                      onChange={(e) => setFeedbackTitle(e.target.value)}
                    />
                    <Textarea
                      placeholder="请描述你遇到的问题或建议（必填）"
                      rows={4}
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
                  </div>
                  <div className="flex justify-end pt-2 pr-2">
                    <Button type="submit" disabled={isSubmittingFeedback}>
                      {isSubmittingFeedback ? '提交中...' : '提交反馈'}
                    </Button>
                  </div>
                </form>

                <div>
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">历史反馈</h3>
                  {isLoadingFeedbacks ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400">加载中...</div>
                  ) : feedbacks.length === 0 ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400">还没有提交过反馈</div>
                  ) : (
                    <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-3 shadow-sm hover:shadow-md transition-shadow ring-1 ring-white/10 dark:ring-white/5 bg-white/30 dark:bg-gray-900/30 backdrop-blur">
                      {feedbacks.map((fb) => (
                        <div
                          key={fb.id}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') handleSelectFeedback(fb.id);
                          }}
                          onClick={(e) => {
                            const target = e.target as HTMLElement | null;
                            if (target?.closest('button, a, input, textarea, select, label')) return;
                            handleSelectFeedback(fb.id);
                          }}
                          className={`glass-card w-full text-left p-4 rounded-2xl flex flex-col gap-1 text-sm shadow-sm hover:shadow-md transition-shadow ${
                            activeFeedbackId === fb.id
                              ? 'ring-2 ring-blue-400/60 dark:ring-blue-400/40 bg-blue-50/20 dark:bg-blue-900/20'
                              : 'ring-1 ring-white/10 dark:ring-white/5 bg-white/20 dark:bg-gray-900/20'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 -m-1 p-1 rounded-lg cursor-pointer">
                            <div className="font-medium text-gray-900 dark:text-white line-clamp-1 flex-1 min-w-0">
                              {fb.title || fb.messages?.[0]?.content || '反馈'}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                                {fb.status === 'pending'
                                  ? '待处理'
                                  : fb.status === 'replied'
                                  ? '已回复'
                                  : '已关闭'}
                              </span>
                              <button
                                type="button"
                                className="no-hover-scale text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-800/50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingDeleteFeedbackId(fb.id);
                                }}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {formatChinaTime(fb.last_message_at || fb.created_at)}
                          </div>
                          {fb.is_resolved_by_user && fb.status !== 'closed' && (
                            <div className="text-[11px] text-green-700 dark:text-green-300">
                              我已标记为已解决{fb.resolved_at ? ` · ${formatChinaTime(fb.resolved_at)}` : ''}
                            </div>
                          )}

                          {activeFeedbackId === fb.id && (
                            <div className="mt-2 border-t border-dashed border-gray-200 dark:border-gray-700 pt-2 space-y-2">
                              {isLoadingFeedbackDetail && !fb.messages && (
                                <div className="text-xs text-gray-500 dark:text-gray-400">加载详情中...</div>
                              )}
                              {fb.messages && Array.isArray(fb.messages) && fb.messages.length > 0 && (
                                <div ref={activeFeedbackChatRef} className="max-h-64 overflow-auto space-y-1 text-xs">
                                  {fb.messages.map((msg: any) => (
                                    <div
                                      key={msg.id}
                                      className={`flex ${
                                        msg.sender_type === 'admin' ? 'justify-end text-blue-600 dark:text-blue-300' : 'justify-start'
                                      }`}
                                    >
                                      <div className="inline-block rounded-lg px-2 py-1 bg-gray-100 dark:bg-gray-800 max-w-[80%] whitespace-pre-wrap break-words">
                                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">
                                          {msg.sender_type === 'admin' ? '管理员' : '我'} · {formatChinaTime(msg.created_at)}
                                        </div>
                                        <div className="text-[13px] text-gray-900 dark:text-gray-100">{msg.content}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {fb.images && Array.isArray(fb.images) && fb.images.length > 0 && (
                                <div className="pt-1">
                                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">附件图片</div>
                                  <div className="flex flex-wrap gap-2">
                                    {fb.images.map((url: string) => (
                                      <a
                                        key={url}
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="block w-16 h-16 rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 bg-black/5"
                                      >
                                        <img src={url} alt="反馈图片" className="w-full h-full object-cover" loading="lazy" />
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* 追加消息与“已解决” */}
                              <div className="pt-2 border-t border-dashed border-gray-200 dark:border-gray-700 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                                    {fb.status === 'closed'
                                      ? '该反馈已关闭'
                                      : '你可以追加问题，或在确认解决后标记为已解决'}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      disabled={isResolvingFeedback || fb.status === 'closed' || !!fb.is_resolved_by_user}
                                      onClick={() => handleResolveFeedback(fb.id)}
                                    >
                                      {fb.is_resolved_by_user ? '已标记解决' : isResolvingFeedback ? '提交中...' : '标记为已解决'}
                                    </Button>
                                  </div>
                                </div>
                                <Textarea
                                  placeholder={fb.status === 'closed' ? '已关闭，无法继续回复' : '追加问题 / 补充信息（发送后状态会回到待处理）'}
                                  rows={3}
                                  value={activeFeedbackReply}
                                  onChange={(e) => setActiveFeedbackReply(e.target.value)}
                                  disabled={fb.status === 'closed'}
                                />
                                <div className="flex justify-end">
                                  <Button
                                    type="button"
                                    disabled={fb.status === 'closed' || isReplyingFeedback || !activeFeedbackReply.trim()}
                                    onClick={() => handleReplyFeedback(fb.id)}
                                  >
                                    {isReplyingFeedback ? '发送中...' : '发送追加'}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

      {/* 对话框组件 */}
      <Dialog
        open={showEditDialog}
        onClose={() => {
          setShowEditDialog(false);
          setEditingList(null);
        }}
        title="编辑收藏列表"
      >
        {editingList && (
          <div className="space-y-4">
            <Input
              label="列表名称"
              value={editingList.name}
              onChange={(e) => setEditingList(prev => ({
                ...prev!,
                name: e.target.value
              }))}
            />
            <Textarea
              label="列表描述（可选）"
              value={editingList.description || ''}
              onChange={(e) => setEditingList(prev => ({
                ...prev!,
                description: e.target.value
              }))}
            />
            <div className="flex items-center gap-2">
              <Switch
                checked={editingList.is_public}
                onCheckedChange={(checked) => setEditingList(prev => ({
                  ...prev!,
                  is_public: checked
                }))}
              />
              <span>公开列表</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowEditDialog(false);
                  setEditingList(null);
                }}
              >
                取消
              </Button>
              <Button 
                onClick={() => handleEditList(editingList!)}
                disabled={!editingList?.name.trim()}
              >
                保存
              </Button>
            </div>
          </div>
        )}
      </Dialog>

        <Dialog
          open={showCreateDialog}
          onClose={() => {
            setShowCreateDialog(false);
            setNewList({ name: '', description: '', is_public: false });
          }}
          title="创建收藏列表"
        >
          <div className="space-y-4">
            <Input
              label="列表名称"
              value={newList.name}
              onChange={(e) => setNewList(prev => ({
                ...prev,
                name: e.target.value
              }))}
              placeholder="请输入列表名称"
            />
            <Textarea
              label="列表描述（可选）"
              value={newList.description}
              onChange={(e) => setNewList(prev => ({
                ...prev,
                description: e.target.value
              }))}
              placeholder="添加一些描述..."
            />
            <div className="flex items-center gap-2">
              <Switch
                checked={newList.is_public}
                onCheckedChange={(checked) => setNewList(prev => ({
                  ...prev,
                  is_public: checked
                }))}
              />
              <span>公开列表</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateDialog(false);
                  setNewList({ name: '', description: '', is_public: false });
                }}
              >
                取消
              </Button>
              <Button 
                onClick={handleCreateList}
                disabled={!newList.name.trim()}
              >
                创建
              </Button>
            </div>
          </div>
        </Dialog>

        {/* 备注对话框 */}
        <Dialog
          open={showNoteDialog}
          onClose={() => {
            setShowNoteDialog(false);
            setEditingFollow(null);
          }}
          title="编辑备注"
        >
          {editingFollow && (
            <div className="space-y-4">
              <div>
                <h3 className="font-medium mb-2">{editingFollow.username}</h3>
                <Textarea
                  label="备注"
                value={editingFollow.note || ''}
                  onChange={(e) => setEditingFollow(prev => ({
                    ...prev!,
                    note: e.target.value
                  }))}
                  placeholder="添加备注..."
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowNoteDialog(false);
                    setEditingFollow(null);
                  }}
                >
                  取消
                </Button>
              <Button onClick={handleUpdateNote}>
                  保存
                </Button>
              </div>
            </div>
          )}
        </Dialog>

        <Dialog
          open={confirmDeleteList !== null}
          onClose={() => setConfirmDeleteList(null)}
          title="删除收藏列表"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              确定要删除「{confirmDeleteList?.name}」吗？此操作不可撤销。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDeleteList(null)}>
                取消
              </Button>
              <Button onClick={confirmDeleteListNow}>
                删除
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog
          open={confirmLogoutOpen}
          onClose={() => setConfirmLogoutOpen(false)}
          title="退出登录"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              确定要退出登录吗？
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmLogoutOpen(false)}>
                取消
              </Button>
              <Button
                onClick={() => {
                  localStorage.removeItem('cachedFavorites');
                  localStorage.removeItem('cachedLists');
                  localStorage.removeItem('cachedFollowing');
                  logout();
                  setConfirmLogoutOpen(false);
                  navigate('/');
                }}
              >
                退出登录
              </Button>
            </div>
          </div>
        </Dialog>
        <ConfirmDialog
          open={pendingDeleteFeedbackId !== null}
          title="删除反馈"
          message="确定要删除这条反馈吗？删除后无法恢复。"
          confirmText="删除"
          cancelText="取消"
          variant="danger"
          onCancel={() => setPendingDeleteFeedbackId(null)}
          onConfirm={() => {
            const id = pendingDeleteFeedbackId;
            setPendingDeleteFeedbackId(null);
            if (id) {
              void handleDeleteFeedback(id);
            }
          }}
        />
        <ConfirmDialog
          open={pendingUnfollowId !== null}
          title="取消关注"
          message="确定要取消关注该用户吗？"
          confirmText="确定"
          cancelText="取消"
          onCancel={() => setPendingUnfollowId(null)}
          onConfirm={() => {
            const id = pendingUnfollowId;
            setPendingUnfollowId(null);
            if (id) {
              void handleUnfollow(id);
            }
          }}
        />
    </PageShell>
  );
} 
