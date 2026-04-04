// ==========================================
// 管理端详情访问管理页
// ==========================================
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download, Film, RefreshCw, Trash2 } from 'lucide-react';
import { authFetch, authFetchJson } from '../../api/authFetch';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { formatChinaDateTime } from '../../shared/utils/time';
import type { FetchStatus } from '../../shared/types/status';

type MediaType = 'movie' | 'tv';

type PlatformRatingFetchStatuses = Record<string, FetchStatus>;

type DetailViewItem = {
  id: number;
  visited_at: string | null;
  media_type: MediaType;
  title: string;
  url: string;
  user: { id: number; email: string; username: string } | null;
  platform_rating_fetch_statuses: PlatformRatingFetchStatuses | null;
};

type DetailViewsResp = {
  items: DetailViewItem[];
  total: number;
  page: number;
  page_size: number;
  filters: {
    date: string | null;
    start_date: string | null;
    end_date: string | null;
    media_type: MediaType | null;
  };
};

function yyyyMmDd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function AdminDetailViewsPage() {
  const [startDate, setStartDate] = useState<string>(() => yyyyMmDd(new Date()));
  const [endDate, setEndDate] = useState<string>(() => yyyyMmDd(new Date()));
  const [mediaType, setMediaType] = useState<MediaType | ''>('');
  const [username, setUsername] = useState('');
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<DetailViewsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [exporting, setExporting] = useState(false);

  const [deleteModal, setDeleteModal] = useState<{ open: boolean; logId: number | null }>({
    open: false,
    logId: null,
  });
  const [batchDeleteModalOpen, setBatchDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    document.title = '详情页访问记录 - RateFuse';
  }, []);

  const baseQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (startDate) p.set('start_date', startDate);
    if (endDate) p.set('end_date', endDate);
    if (mediaType) p.set('media_type', mediaType);
    if (username.trim()) p.set('username', username.trim());
    return p.toString();
  }, [startDate, endDate, mediaType, username]);

  const query = useMemo(() => {
    const p = new URLSearchParams(baseQuery);
    p.set('page', String(page));
    p.set('page_size', String(pageSize));
    return p.toString();
  }, [baseQuery, page, pageSize]);

  async function load() {
    setLoading(true);
    setError('');
    setActionError('');
    if (startDate > endDate) {
      setError('开始日期不能大于结束日期');
      setData(null);
      setLoading(false);
      return;
    }
    try {
      const res = await authFetchJson<DetailViewsResp>(`/api/admin/detail-views?${query}`);
      setData(res);
      setSelectedIds([]);
    } catch (e: any) {
      setError(e?.message || '加载失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [query]);

  const totalPages = data ? Math.max(1, Math.ceil((data.total || 0) / pageSize)) : 1;
  const normalizedUsername = username.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    const items = data?.items || [];
    if (!normalizedUsername) return items;
    return items.filter((it) => {
      const name = it.user?.username?.toLowerCase?.() || '';
      return name.includes(normalizedUsername);
    });
  }, [data?.items, normalizedUsername]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  function goToPage() {
    const parsedPage = Number.parseInt(pageInput, 10);
    if (Number.isNaN(parsedPage)) return;
    const targetPage = Math.min(Math.max(parsedPage, 1), totalPages);
    if (targetPage !== page) {
      setPage(targetPage);
    } else {
      setPageInput(String(targetPage));
    }
  }

  const platformLabelMap: Record<string, string> = {
    douban: '豆瓣',
    imdb: 'IMDb',
    letterboxd: 'Letterboxd',
    rottentomatoes: '烂番茄',
    metacritic: 'Metacritic',
    tmdb: 'TMDB',
    trakt: 'Trakt',
  };

  const statusCnMap: Record<string, string> = {
    successful: '成功',
    error: '失败',
    fail: '失败',
    rate_limit: '限制',
    timeout: '超时',
    not_found: '未收',
    locked: '未收',
    no_rating: '暂无',
    pending: '待取',
    loading: '加载',
  };

  const platformOrder = [
    'douban',
    'imdb',
    'letterboxd',
    'rottentomatoes',
    'metacritic',
    'tmdb',
    'trakt',
  ] as const;

  function getPlatformStatusTitle(statuses: PlatformRatingFetchStatuses | null) {
    if (!statuses) return '-';
    const parts = platformOrder
      .map((k) => {
        const v = statuses[k];
        if (!v) return null;
        return `${platformLabelMap[k] || k}:${statusCnMap[v] || v}`;
      })
      .filter(Boolean);
    return parts.length ? parts.join(', ') : '-';
  }

  function renderPlatformStatusLines(statuses: PlatformRatingFetchStatuses | null) {
    if (!statuses) return '-';
    const hasAny = platformOrder.some((k) => statuses[k]);
    if (!hasAny) return '-';

    return (
      <div className="flex flex-col gap-1">
        {platformOrder
          .map((k) => {
            const v = statuses[k];
            if (!v) return null;
            const label = platformLabelMap[k] || k;
            const cnStatus = statusCnMap[v] || v;
            return (
              <div key={k} className="text-xs leading-relaxed text-gray-700 dark:text-gray-100">
                {label}：{cnStatus}
              </div>
            );
          })
          .filter(Boolean)}
      </div>
    );
  }

  async function handleExportExcel() {
    setExporting(true);
    setActionError('');
    try {
      const res = await authFetch(`/api/admin/detail-views/export?${baseQuery}`, {
        method: 'GET',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || '导出失败');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const disposition = res.headers.get('Content-Disposition');
      const match = disposition?.match(/filename="([^"]+)"/);
      const fileName = match?.[1] || `detail_views_${startDate}_to_${endDate}.xls`;

      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setActionError(e?.message || '导出失败');
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteConfirm() {
    if (deleting) return;
    if (!deleteModal.logId) return;
    setDeleting(true);
    setActionError('');
    try {
      const res = await authFetch(`/api/admin/detail-views/${deleteModal.logId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || '删除失败');
      }

      setDeleteModal({ open: false, logId: null });
      await load();
    } catch (e: any) {
      setActionError(e?.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelectAllCurrentPage() {
    if (!visibleItems.length) return;
    const currentIds = visibleItems.map((it) => it.id);
    const allSelected = currentIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !currentIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...currentIds])));
    }
  }

  function toggleSelectOne(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleBatchDelete() {
    if (!selectedIds.length) return;
    setDeleting(true);
    setActionError('');
    try {
      const res = await authFetch('/api/admin/detail-views/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || '批量删除失败');
      }
      setSelectedIds([]);
      await load();
    } catch (e: any) {
      setActionError(e?.message || '批量删除失败');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">
            详情页访问记录
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            可按日期范围筛选用户访问了哪些电影/剧集详情页
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            disabled={loading || exporting}
            title="导出当前筛选范围的 Excel 文件"
          >
            <Download className={`w-4 h-4 ${exporting ? 'animate-spin' : ''}`} />
            导出Excel
          </button>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/50 p-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 min-w-0">
            <label className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-1">
              <CalendarDays className="w-4 h-4" />
              开始日期（YYYY-MM-DD）
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="w-full max-w-full min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 text-gray-900 dark:text-white text-sm"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-1">
              <CalendarDays className="w-4 h-4" />
              结束日期（YYYY-MM-DD）
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="w-full max-w-full min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 text-gray-900 dark:text-white text-sm"
            />
          </div>
          <div className="w-full sm:w-56 min-w-0">
            <label className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-1">
              <Film className="w-4 h-4" />
              类型
            </label>
            <select
              value={mediaType}
              onChange={(e) => {
                setMediaType(e.target.value as any);
                setPage(1);
              }}
              className="w-full max-w-full min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 text-gray-900 dark:text-white text-sm"
            >
              <option value="">全部</option>
              <option value="movie">电影</option>
              <option value="tv">剧集</option>
            </select>
          </div>
          <div className="w-full sm:w-56 min-w-0">
            <label className="text-sm text-gray-700 dark:text-gray-300 mb-1 block">用户昵称</label>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setPage(1);
              }}
              placeholder="输入昵称关键字"
              className="w-full max-w-full min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 text-gray-900 dark:text-white text-sm"
            />
          </div>
          <div className="w-full sm:w-44 min-w-0">
            <label className="text-sm text-gray-700 dark:text-gray-300 mb-1 block">每页</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="w-full max-w-full min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 text-gray-900 dark:text-white text-sm"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>

        {error ? <div className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</div> : null}
        {actionError ? <div className="mt-3 text-sm text-red-600 dark:text-red-400">{actionError}</div> : null}
      </div>

      <div className="mt-5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/50 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 text-xs text-gray-500 dark:text-gray-400">
          <div>
            已选择 <span className="font-semibold">{selectedIds.length}</span> 条访问记录
          </div>
          <button
            type="button"
            onClick={() => setBatchDeleteModalOpen(true)}
            className="inline-flex items-center gap-2 px-2 py-1.5 rounded-lg border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
            disabled={deleting || !selectedIds.length || loading}
          >
            <Trash2 className="w-4 h-4" />
            批量删除
          </button>
        </div>
        <div className="overflow-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/30 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="text-left font-medium px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 dark:border-gray-600"
                    checked={
                      !!visibleItems.length &&
                      visibleItems.every((it) => selectedIds.includes(it.id))
                    }
                    onChange={toggleSelectAllCurrentPage}
                  />
                </th>
                <th className="text-left font-medium px-4 py-3">访问时间</th>
                <th className="text-left font-medium px-4 py-3">影视类型</th>
                <th className="text-left font-medium px-4 py-3">影视名称</th>
                <th className="text-left font-medium px-4 py-3">影视链接</th>
                <th className="text-left font-medium px-4 py-3">用户</th>
                <th className="text-left font-medium px-4 py-3">各平台评分获取状态</th>
                <th className="text-left font-medium px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500 dark:text-gray-400" colSpan={7}>
                    加载中...
                  </td>
                </tr>
              ) : visibleItems.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500 dark:text-gray-400" colSpan={7}>
                    暂无记录
                  </td>
                </tr>
              ) : (
              visibleItems.map((it, _idx) => (
                <tr key={it.id} className="text-gray-800 dark:text-gray-100">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 dark:border-gray-600"
                      checked={selectedIds.includes(it.id)}
                      onChange={() => toggleSelectOne(it.id)}
                    />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                      {it.visited_at ? formatChinaDateTime(it.visited_at) : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{it.media_type === 'movie' ? '电影' : '剧集'}</td>
                    <td className="px-4 py-3 max-w-[360px] truncate" title={it.title}>
                      {it.title}
                    </td>
                    <td className="px-4 py-3 max-w-[420px] truncate">
                      <a
                        href={it.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                        title={it.url}
                      >
                        {it.url}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      {it.user ? (
                        <div className="flex flex-col">
                          <span className="font-medium">{it.user.username}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{it.user.email}</span>
                        </div>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">未登录</span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[520px] whitespace-normal" title={getPlatformStatusTitle(it.platform_rating_fetch_statuses)}>
                      {renderPlatformStatusLines(it.platform_rating_fetch_statuses)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setDeleteModal({ open: true, logId: it.id })}
                        className="inline-flex items-center gap-2 px-2 py-1.5 rounded-lg border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                        disabled={deleting}
                        title="删除该访问记录"
                      >
                        <Trash2 className="w-4 h-4" />
                        删除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 dark:border-gray-800 text-sm">
          <div className="text-gray-600 dark:text-gray-300">
            共 <span className="font-medium">{data?.total ?? 0}</span> 条
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
              disabled={loading || page <= 1}
            >
              上一页
            </button>
            <span className="text-gray-600 dark:text-gray-300">
              第 <span className="font-medium">{page}</span> / {totalPages} 页
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
              disabled={loading || page >= totalPages}
            >
              下一页
            </button>
            <div className="flex items-center gap-2 ml-1">
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') goToPage();
                }}
                className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 text-gray-900 dark:text-white"
                aria-label="输入页码"
              />
              <button
                type="button"
                onClick={goToPage}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
                disabled={loading}
              >
                跳转
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteModal.open}
        title="删除访问记录"
        message="确定要删除该访问记录吗？删除后无法恢复。"
        confirmText={deleting ? '删除中...' : '删除'}
        cancelText="取消"
        variant="danger"
        onCancel={() => setDeleteModal({ open: false, logId: null })}
        onConfirm={() => void handleDeleteConfirm()}
      />
      <ConfirmDialog
        open={batchDeleteModalOpen}
        title="批量删除访问记录"
        message={`确定要删除选中的 ${selectedIds.length} 条访问记录吗？删除后无法恢复。`}
        confirmText={deleting ? '删除中...' : '删除'}
        cancelText="取消"
        variant="danger"
        onCancel={() => setBatchDeleteModalOpen(false)}
        onConfirm={() => {
          setBatchDeleteModalOpen(false);
          void handleBatchDelete();
        }}
      />
    </div>
  );
}
