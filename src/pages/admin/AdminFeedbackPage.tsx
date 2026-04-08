// ==========================================
// 管理端反馈处理页
// ==========================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { authFetchJson } from '../../api/authFetch';
import { Button } from '../../shared/ui/Button';
import { Textarea } from '../../shared/ui/Textarea';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { cn } from '../../shared/utils/utils';
import { formatChinaDateTime } from '../../shared/utils/time';

const formatChinaTime = (value?: string | null) => {
  return formatChinaDateTime(value);
};

interface FeedbackMessage {
  id: number;
  sender_id: number | null;
  sender_type: 'user' | 'admin';
  content: string;
  created_at: string;
}

interface FeedbackItem {
  id: number;
  user_id: number;
  title: string | null;
  status: 'pending' | 'replied' | 'closed';
  is_resolved_by_user?: boolean;
  resolved_at?: string | null;
  closed_by?: 'admin' | 'user' | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  images: string[];
  user?: {
    id: number;
    email: string;
    username: string;
  };
  messages?: FeedbackMessage[];
}

const STATUS_OPTIONS: { value: FeedbackItem['status'] | 'all'; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待处理' },
  { value: 'replied', label: '已回复' },
  { value: 'closed', label: '已关闭' },
];

export default function AdminFeedbackPage() {
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | FeedbackItem['status']>('pending');
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [replying, setReplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.title = '用户反馈管理 - RateFuse';
  }, []);

  const loadList = async () => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const data = await authFetchJson<FeedbackItem[]>(`/api/admin/feedbacks?${params.toString()}`);
      setFeedbacks((prev) => {
        const prevById = new Map<number, FeedbackItem>(prev.map((x) => [x.id, x]));
        return (data || []).map((x) => {
          const old = prevById.get(x.id);
          return old?.messages ? ({ ...x, messages: old.messages } as FeedbackItem) : x;
        });
      });
      setActiveId((prev) => {
        const arr = data || [];
        if (arr.length === 0) return null;
        if (prev && arr.some((x) => x.id === prev)) return prev;
        return arr[0].id;
      });
    } catch (e) {
      console.error('加载反馈列表失败', e);
    } finally {
      setLoadingList(false);
    }
  };

  const loadDetail = async (id: number) => {
    setLoadingDetail(true);
    try {
      const data = await authFetchJson<FeedbackItem>(`/api/admin/feedbacks/${id}`);
      setFeedbacks((prev) => prev.map((f) => (f.id === id ? data : f)));
    } catch (e) {
      console.error('加载反馈详情失败', e);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    loadList();
  }, [statusFilter]);

  useEffect(() => {
    let cancelled = false;
    const tickList = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      await loadList();
    };
    tickList();
    const timer = window.setInterval(tickList, 8000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tickList();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [statusFilter]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const tickDetail = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      await loadDetail(activeId);
    };
    tickDetail();
    const timer = window.setInterval(tickDetail, 6000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tickDetail();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeId]);

  const activeFeedback = useMemo(() => feedbacks.find((f) => f.id === activeId) || null, [feedbacks, activeId]);

  useEffect(() => {
    if (!activeFeedback?.messages) return;
    const el = chatRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [activeId, activeFeedback?.messages?.length]);

  const handleSelect = (id: number) => {
    setActiveId(id);
    loadDetail(id);
  };

  const handleReply = async () => {
    if (!activeFeedback || !replyContent.trim()) return;
    setReplying(true);
    try {
      const data = await authFetchJson<FeedbackItem>(`/api/admin/feedbacks/${activeFeedback.id}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: replyContent.trim(),
        }),
      });
      setFeedbacks((prev) => prev.map((f) => (f.id === data.id ? data : f)));
      setReplyContent('');
    } catch (e) {
      console.error('回复失败', e);
    } finally {
      setReplying(false);
    }
  };

  const handleStatusChange = async (status: FeedbackItem['status']) => {
    if (!activeFeedback) return;
    try {
      const data = await authFetchJson<FeedbackItem>(`/api/admin/feedbacks/${activeFeedback.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });
      setFeedbacks((prev) => prev.map((f) => (f.id === data.id ? data : f)));
    } catch (e) {
      console.error('更新状态失败', e);
    }
  };

  const handleDeleteFromList = async (id: number) => {
    setDeleting(true);
    try {
      const res = await authFetchJson<{ ok: boolean }>(`/api/admin/feedbacks/${id}`, { method: 'DELETE' });
      if (!res?.ok) throw new Error('删除失败');
      setFeedbacks((prev) => prev.filter((f) => f.id !== id));
      setActiveId((prev) => {
        if (prev !== id) return prev;
        const remain = feedbacks.filter((f) => f.id !== id);
        return remain.length ? remain[0].id : null;
      });
    } catch (e) {
      console.error('删除失败', e);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">用户反馈</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-4 text-sm sm:text-base">
        查看并处理用户提交的使用问题和产品建议。
      </p>

      <div className="flex items-center gap-3 mb-4">
        <select
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-1.5"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={loadList} disabled={loadingList}>
          刷新
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)]">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 overflow-hidden">
          <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
            共 {feedbacks.length} 条
          </div>
          <div className="max-h-[520px] overflow-y-auto overflow-x-hidden hide-scrollbar divide-y divide-gray-100 dark:divide-gray-800">
            {loadingList && feedbacks.length === 0 ? (
              <div className="p-4 text-sm text-gray-500 dark:text-gray-400">加载中...</div>
            ) : feedbacks.length === 0 ? (
              <div className="p-4 text-sm text-gray-500 dark:text-gray-400">暂无反馈</div>
            ) : (
              feedbacks.map((fb) => (
                <div
                  key={fb.id}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleSelect(fb.id);
                  }}
                  onClick={(e) => {
                    const target = e.target as HTMLElement | null;
                    if (target?.closest('button, a, input, textarea, select, label')) return;
                    handleSelect(fb.id);
                  }}
                  className={cn(
                    'w-full px-4 py-3 flex flex-col gap-1 hover:bg-gray-50 dark:hover:bg-gray-800/80 transition-colors',
                    activeId === fb.id && 'bg-blue-50/70 dark:bg-blue-900/30'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-50 line-clamp-1 flex-1 min-w-0 cursor-pointer">
                      {fb.title || '无标题'}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium',
                          fb.status === 'pending'
                            ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                            : fb.status === 'replied'
                            ? 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        )}
                      >
                        {fb.status === 'pending' ? '待处理' : fb.status === 'replied' ? '已回复' : '已关闭'}
                      </span>
                      <button
                        type="button"
                        className="no-hover-scale text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-800/50"
                        disabled={deleting}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteId(fb.id);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    用户：{fb.user?.username || fb.user?.email || `#${fb.user_id}`}
                  </div>
                  <div className="text-xs text-gray-400">
                    更新于：{formatChinaTime(fb.last_message_at || fb.updated_at || fb.created_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 p-4 flex flex-col min-h-[360px]">
          {!activeFeedback ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
              请选择左侧一条反馈查看详情
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
                    {activeFeedback.title || '无标题'}
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    用户：{activeFeedback.user?.username || activeFeedback.user?.email || `#${activeFeedback.user_id}`}
                  </p>
                  {activeFeedback.is_resolved_by_user && activeFeedback.status !== 'closed' && (
                    <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                      用户已标记为已解决{activeFeedback.resolved_at ? ` · ${formatChinaTime(activeFeedback.resolved_at)}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs px-2 py-1"
                    value={activeFeedback.status}
                    onChange={(e) => handleStatusChange(e.target.value as FeedbackItem['status'])}
                  >
                    <option value="pending">待处理</option>
                    <option value="replied">已回复</option>
                    <option value="closed">已关闭</option>
                  </select>
                </div>
              </div>

              <div
                ref={chatRef}
                className="flex-1 rounded-lg bg-gray-50 dark:bg-gray-900/70 p-3 mb-3 overflow-auto space-y-3"
              >
                {loadingDetail && !activeFeedback.messages?.length ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">加载对话中...</div>
                ) : !activeFeedback.messages || activeFeedback.messages.length === 0 ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">暂无对话内容</div>
                ) : (
                  activeFeedback.messages.map((msg) => {
                    const isAdmin = msg.sender_type === 'admin';
                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          'flex gap-2 text-xs',
                          isAdmin ? 'justify-end' : 'justify-start'
                        )}
                      >
                        <div
                          className={cn(
                            'max-w-[80%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words',
                            isAdmin
                              ? 'bg-blue-500 text-white rounded-br-sm'
                              : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 rounded-bl-sm shadow-sm'
                          )}
                        >
                          <div>{msg.content}</div>
                          <div className={cn('mt-1 text-[10px]', isAdmin ? 'text-blue-100' : 'text-gray-400')}>
                            {formatChinaTime(msg.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {activeFeedback.images && activeFeedback.images.length > 0 && (
                  <div className="pt-2 border-t border-dashed border-gray-200 dark:border-gray-700 mt-1">
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">附件图片</div>
                    <div className="flex flex-wrap gap-2">
                      {activeFeedback.images.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block w-20 h-20 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-black/5"
                        >
                          <img src={url} alt="反馈图片" className="w-full h-full object-cover" loading="lazy" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
                <Textarea
                  rows={3}
                  placeholder="输入回复内容，按下方按钮发送"
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                />
                <div className="mt-2 flex justify-end">
                  <Button disabled={replying || !replyContent.trim()} onClick={handleReply}>
                    {replying ? '发送中...' : '发送回复'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="删除反馈"
        message="确定要删除这条反馈吗？删除后将同时删除消息与附件，无法恢复。"
        confirmText={deleting ? '删除中...' : '删除'}
        cancelText="取消"
        variant="danger"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          const id = pendingDeleteId;
          setPendingDeleteId(null);
          if (id) {
            void handleDeleteFromList(id);
          }
        }}
      />
    </div>
  );
}
