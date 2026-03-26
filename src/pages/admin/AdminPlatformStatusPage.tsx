// ==========================================
// 管理端平台状态页
// ==========================================
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, Unlock, RefreshCw, Search, AlertTriangle } from 'lucide-react';
import type { MediaPlatformStatusItem } from '../../api/platformStatus';
import {
  fetchLockedPlatformStatus,
  lockPlatformStatus,
  unlockPlatformStatus,
} from '../../api/platformStatus';
import { CardTabs } from '../../shared/ui/CardTabs';
import { AdminMediaSearchResults } from '../../modules/admin/AdminMediaSearchResults';
import { adminSearchMedia } from '../../api/adminSearch';
import { useDebounce } from '../../shared/hooks/useDebounce';
import { formatChinaDateTime } from '../../shared/utils/time';

const PLATFORM_LABELS: Record<string, string> = {
  douban: '豆瓣',
  imdb: 'IMDb',
  letterboxd: 'Letterboxd',
  rottentomatoes: '烂番茄',
  metacritic: 'Metacritic',
  tmdb: 'TMDB',
  trakt: 'Trakt',
};

const MEDIA_TYPE_LABELS: Record<string, string> = {
  movie: '电影',
  tv: '剧集',
};

const PLATFORM_CONFIG = [
  { id: 'douban', label: '豆瓣' },
  { id: 'imdb', label: 'IMDb' },
  { id: 'letterboxd', label: 'Letterboxd' },
  { id: 'rottentomatoes', label: '烂番茄' },
  { id: 'metacritic', label: 'Metacritic' },
  { id: 'tmdb', label: 'TMDB' },
  { id: 'trakt', label: 'Trakt' },
] as const;

type MediaType = 'movie' | 'tv';

interface MediaItem {
  id: number;
  type: MediaType;
  title: string;
  poster: string;
  year?: number;
}

export default function AdminPlatformStatusPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<MediaType>('movie');
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const debouncedQuery = useDebounce(searchQuery, 350);
  const { data: searchData } = useQuery({
    queryKey: ['admin-platform-status-search', debouncedQuery],
    queryFn: () => adminSearchMedia(debouncedQuery),
    enabled: !!debouncedQuery,
  });

  const movies = searchData?.movies?.results ?? [];
  const tvs = searchData?.tvShows?.results ?? [];
  const filteredItems = (searchType === 'movie' ? movies : tvs).slice(0, 12);

  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [lockRemark, setLockRemark] = useState('');
  const [locking, setLocking] = useState(false);

  const [lockedPlatformsForMedia, setLockedPlatformsForMedia] = useState<Set<string>>(new Set());

  const [mediaType, setMediaType] = useState<string>('');
  const [platform, setPlatform] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [pageSize, setPageSize] = useState(20);
  const [listTotal, setListTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MediaPlatformStatusItem[]>([]);
  const [error, setError] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [unlockingId, setUnlockingId] = useState<number | null>(null);

  useEffect(() => {
    document.title = '平台锁定状态 - RateFuse';
  }, []);

  const queryParams = useMemo(
    () => ({
      media_type: mediaType || undefined,
      platform: platform || undefined,
      title: title.trim() || undefined,
      page,
      page_size: pageSize,
    }),
    [mediaType, platform, title, page, pageSize],
  );

  const totalPages = Math.max(1, Math.ceil((listTotal || 0) / pageSize));

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

  useEffect(() => {
    async function loadMediaLocks() {
      if (!selectedMedia) {
        setLockedPlatformsForMedia(new Set());
        setSelectedPlatforms(new Set());
        return;
      }
      try {
        const data = await fetchLockedPlatformStatus({
          media_type: selectedMedia.type,
          tmdb_id: selectedMedia.id,
        });
        const locked = new Set<string>(data.items.map((x) => x.platform.toLowerCase()));
        setLockedPlatformsForMedia(locked);
        setSelectedPlatforms(new Set());
      } catch (e) {
      }
    }
    void loadMediaLocks();
  }, [selectedMedia]);

  async function load() {
    setLoading(true);
    setError('');
    setActionError('');
    try {
      const data = await fetchLockedPlatformStatus(queryParams);
      setItems(data.items);
      setListTotal(data.total);
    } catch (e: any) {
      setError(e?.message || '加载失败');
      setItems([]);
      setListTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [queryParams]);

  async function handleUnlock(item: MediaPlatformStatusItem) {
    if (unlockingId != null) return;
    setUnlockingId(item.id);
    setActionError('');
    try {
      await unlockPlatformStatus({
        media_type: item.media_type,
        tmdb_id: item.tmdb_id,
        platform: item.platform,
      });
      await load();
    } catch (e: any) {
      setActionError(e?.message || '解锁失败');
    } finally {
      setUnlockingId(null);
    }
  }

  const hasFilter = Boolean(mediaType || platform || title.trim());

  async function handleBulkLockUnlock(action: 'lock' | 'unlock') {
    if (!selectedMedia) {
      setActionError('请先选择影视');
      return;
    }
    if (selectedPlatforms.size === 0) {
      setActionError('请先勾选至少一个平台');
      return;
    }
    setLocking(true);
    setActionError('');
    try {
      const tasks: Promise<unknown>[] = [];
      const remarkVal = lockRemark.trim() || undefined;
      selectedPlatforms.forEach((p) => {
        if (action === 'lock') {
          tasks.push(
            lockPlatformStatus({
              media_type: selectedMedia.type,
              tmdb_id: selectedMedia.id,
              platform: p,
              title: selectedMedia.title,
              remark: remarkVal,
            }),
          );
        } else {
          tasks.push(
            unlockPlatformStatus({
              media_type: selectedMedia.type,
              tmdb_id: selectedMedia.id,
              platform: p,
              remark: remarkVal,
            }),
          );
        }
      });
      await Promise.all(tasks);
      const latest = await fetchLockedPlatformStatus({
        media_type: selectedMedia.type,
        tmdb_id: selectedMedia.id,
      });
      setLockedPlatformsForMedia(new Set(latest.items.map((x) => x.platform.toLowerCase())));
      setSelectedPlatforms(new Set());
      void load();
    } catch (e: any) {
      setActionError(e?.message || (action === 'lock' ? '锁定失败' : '解锁失败'));
    } finally {
      setLocking(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">
            平台锁定状态
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            查看并管理影视在各平台的抓取锁定状态，避免对明确不会收录的影片重复抓取
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 1. 搜索并选择影视 */}
      <section className="mb-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-4">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-3">1. 选择影视</h2>
        <div className="mb-3">
          <CardTabs
            tabs={[
              { id: 'movie', label: '电影' },
              { id: 'tv', label: '剧集' },
            ]}
            activeId={searchType}
            onChange={(id: string) => {
              setSelectedMedia(null);
              setSearchType(id as MediaType);
            }}
          />
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={searchType === 'movie' ? '搜索电影...' : '搜索剧集...'}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white glass-dropdown"
          />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          支持多语言、影视名称加年份（如：星际穿越 2014）、IMDB ID、TMDB ID
        </p>
        <AdminMediaSearchResults
          items={filteredItems}
          selectedItem={selectedMedia}
          onSelect={setSelectedMedia}
          onClearSelection={() => setSelectedMedia(null)}
          emptyMessage={debouncedQuery ? '暂无搜索结果' : undefined}
        />
      </section>

      {/* 2. 对当前影视勾选平台并锁定/解锁 */}
      <section className="mb-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-4">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-3">2. 选择平台并锁定/解锁</h2>
        {!selectedMedia ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">请先在上方选择一个影视。</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {PLATFORM_CONFIG.map((p) => {
                const isLocked = lockedPlatformsForMedia.has(p.id);
                const checked = selectedPlatforms.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedPlatforms((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) {
                          next.delete(p.id);
                        } else {
                          next.add(p.id);
                        }
                        return next;
                      });
                    }}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                      checked
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-200'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={checked}
                      className="w-3 h-3 rounded border-gray-300 dark:border-gray-600"
                    />
                    <span>{p.label}</span>
                    {isLocked && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-red-500">
                        <Lock className="w-3 h-3" />
                        已锁定
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                备注（选填）
              </label>
              <input
                type="text"
                value={lockRemark}
                onChange={(e) => setLockRemark(e.target.value)}
                placeholder="添加锁定/解锁备注，便于日后查看"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500 glass-dropdown"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={locking}
                onClick={() => void handleBulkLockUnlock('lock')}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500 text-white text-xs hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                <Lock className="w-3 h-3" />
                锁定所选平台
              </button>
              <button
                type="button"
                disabled={locking}
                onClick={() => void handleBulkLockUnlock('unlock')}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500 text-white text-xs hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                <Unlock className="w-3 h-3" />
                解锁所选平台
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 3. 锁定记录列表 */}
      <div className="mb-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex-1 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              影视名称（模糊搜索）
            </label>
            <div className="relative">
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setPage(1);
                }}
                placeholder="输入 TMDB 标题关键字"
                className="w-full px-3 py-2 pr-8 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500 glass-dropdown"
              />
              <Search className="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              媒体类型
            </label>
            <select
              value={mediaType}
              onChange={(e) => {
                setMediaType(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500 glass-dropdown"
            >
              <option value="">全部</option>
              <option value="movie">电影</option>
              <option value="tv">剧集</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              平台
            </label>
            <select
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500 glass-dropdown"
            >
              <option value="">全部</option>
              <option value="douban">豆瓣</option>
              <option value="imdb">IMDb</option>
              <option value="letterboxd">Letterboxd</option>
              <option value="rottentomatoes">烂番茄</option>
              <option value="metacritic">Metacritic</option>
              <option value="tmdb">TMDB</option>
              <option value="trakt">Trakt</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              每页
            </label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500 glass-dropdown"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm hover:bg-blue-600 transition-colors disabled:opacity-50"
            disabled={loading}
          >
            <Search className="w-4 h-4" />
            应用筛选
          </button>
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setMediaType('');
                setPlatform('');
                setTitle('');
                setPage(1);
                setPageInput('1');
              }}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/80 transition-colors"
            >
              清空
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}
      {actionError && (
        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 text-yellow-700 text-sm px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 overflow-hidden">
        <div className="overflow-x-auto scrollbar-gentle">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/80">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  时间
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  类型
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  影视名称
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  平台
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  失败次数
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  备注
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-8 text-center text-gray-500 dark:text-gray-400"
                  >
                    加载中...
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-8 text-center text-gray-500 dark:text-gray-400"
                  >
                    暂无锁定记录
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((item) => {
                  const platformLabel =
                    PLATFORM_LABELS[item.platform.toLowerCase()] || item.platform;
                  const mediaLabel =
                    MEDIA_TYPE_LABELS[item.media_type.toLowerCase()] ||
                    item.media_type;
                  const updatedAt = item.updated_at
                    ? formatChinaDateTime(item.updated_at)
                    : '-';
                  return (
                    <tr
                      key={item.id}
                      className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50/70 dark:hover:bg-gray-800/60"
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 dark:text-gray-300">
                        {updatedAt}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700 dark:text-gray-200">
                        {mediaLabel}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-900 dark:text-gray-100 max-w-xs">
                        <div className="font-medium truncate">
                          {item.title || '(未记录标题)'}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">
                          TMDB ID: {item.tmdb_id}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700 dark:text-gray-200">
                        <span className="inline-flex items-center gap-1">
                          <Lock className="w-3 h-3 text-red-500" />
                          {platformLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700 dark:text-gray-200">
                        {item.failure_count ?? 0}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-200 max-w-sm">
                        <div className="line-clamp-2 break-all">
                          {item.remark || '-'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void handleUnlock(item)}
                          disabled={unlockingId === item.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/70 disabled:opacity-50"
                        >
                          <Unlock className="w-3 h-3" />
                          解锁
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 dark:border-gray-800 text-sm">
          <div className="text-gray-600 dark:text-gray-300">
            共 <span className="font-medium">{listTotal}</span> 条
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
    </div>
  );
}
