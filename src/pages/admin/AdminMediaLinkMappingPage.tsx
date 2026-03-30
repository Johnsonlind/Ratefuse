// ==========================================
// 管理端影视链接映射库
// ==========================================
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '../../shared/ui/Input';
import { Button } from '../../shared/ui/Button';
import { Pagination } from '../../shared/ui/Pagination';
import { Dialog } from '../../shared/ui/Dialog';
import { adminSearchMedia, type AdminMediaItem } from '../../api/adminSearch';
import { AdminMediaSearchResults } from '../../modules/admin/AdminMediaSearchResults';
import { CardTabs } from '../../shared/ui/CardTabs';
import { useDebounce } from '../../shared/hooks/useDebounce';
import {
  fetchMediaLinkMappings,
  createMediaLinkMapping,
  updateMediaLinkMapping,
  deleteMediaLinkMapping,
  type MediaLinkMappingItem,
  type MediaType,
} from '../../api/mediaLinkMapping';

type PageSize = 20 | 50 | 100 | 200;
type SeasonUrlEntry = { season_number: number; url: string };
type DoubanSeasonEntry = { season_number: number; url: string; douban_id: string };

function formatBeijingDateTime(value?: string | null): string {
  const s = String(value || '').trim();
  if (!s) return '-';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function extractDoubanIdFromUrl(url: string): string | null {
  const m = String(url || '').match(/\/subject\/(\d+)/);
  return m?.[1] || null;
}

function extractLetterboxdSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'film' && parts[1]) return parts[1];
    return null;
  } catch {
    const m = String(url || '').match(/letterboxd\.com\/film\/([^/]+)/i);
    return m?.[1] || null;
  }
}

function extractRtSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, '') || null;
  } catch {
    const m = String(url || '').match(/rottentomatoes\.com\/(.+)$/i);
    return m?.[1]?.replace(/^\/+/, '') || null;
  }
}

function extractMetacriticSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, '') || null;
  } catch {
    const m = String(url || '').match(/metacritic\.com\/(.+)$/i);
    return m?.[1]?.replace(/^\/+/, '') || null;
  }
}

function parseSeasonUrlJson(jsonText?: string | null): SeasonUrlEntry[] {
  if (!jsonText) return [];
  try {
    const obj = JSON.parse(jsonText);
    if (!obj || typeof obj !== 'object') return [];
    return Object.entries(obj)
      .map(([k, v]) => ({ season_number: Number(k), url: String(v || '') }))
      .filter((x) => Number.isFinite(x.season_number) && x.season_number > 0)
      .sort((a, b) => a.season_number - b.season_number);
  } catch {
    return [];
  }
}

function parseDoubanSeasonJson(urlJson?: string | null, idsJson?: string | null): DoubanSeasonEntry[] {
  const urls = parseSeasonUrlJson(urlJson);
  let ids: Record<string, string> = {};
  try {
    const parsed = idsJson ? JSON.parse(idsJson) : {};
    if (parsed && typeof parsed === 'object') ids = parsed;
  } catch {
    ids = {};
  }
  return urls.map((x) => ({
    season_number: x.season_number,
    url: x.url,
    douban_id: String(ids[String(x.season_number)] || extractDoubanIdFromUrl(x.url) || ''),
  }));
}

function buildPlatformLink(item: MediaLinkMappingItem, platform: string): string | null {
  if (platform === 'douban') {
    if (item.douban_url) return item.douban_url;
    if (item.douban_id) return `https://movie.douban.com/subject/${item.douban_id}/`;
    return null;
  }
  if (platform === 'letterboxd') {
    if (item.letterboxd_url) return item.letterboxd_url;
    if (!item.letterboxd_slug) return null;
    return `https://letterboxd.com/film/${item.letterboxd_slug.replace(/^\/+|\/+$/g, '')}/`;
  }
  if (platform === 'rottentomatoes') {
    if (item.rotten_tomatoes_url) return item.rotten_tomatoes_url;
    if (!item.rotten_tomatoes_slug) return null;
    return `https://www.rottentomatoes.com/${item.rotten_tomatoes_slug.replace(/^\/+/, '')}`;
  }
  if (platform === 'metacritic') {
    if (item.metacritic_url) return item.metacritic_url;
    if (!item.metacritic_slug) return null;
    return `https://www.metacritic.com/${item.metacritic_slug.replace(/^\/+/, '')}`;
  }
  return null;
}

function LinkCell({ href, label }: { href: string | null; label: string }) {
  if (!href) return <span className="text-gray-400">-</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 dark:text-blue-400 hover:underline break-all"
      title={href}
    >
      {label}
    </a>
  );
}

function parseSeasonLinks(jsonText?: string | null): { season: number; url: string }[] {
  return parseSeasonUrlJson(jsonText).map((x) => ({ season: x.season_number, url: x.url }));
}

function PlatformLinksCell({
  item,
  platform,
}: {
  item: MediaLinkMappingItem;
  platform: 'douban' | 'letterboxd' | 'rottentomatoes' | 'metacritic';
}) {
  if (
    item.media_type !== 'tv' ||
    (platform !== 'douban' && platform !== 'rottentomatoes' && platform !== 'metacritic')
  ) {
    return <LinkCell href={buildPlatformLink(item, platform)} label="打开" />;
  }

  const seriesHref = buildPlatformLink(item, platform);
  const seasonJson =
    platform === 'douban'
      ? (item as any).douban_seasons_json
      : platform === 'rottentomatoes'
        ? (item as any).rotten_tomatoes_seasons_json
        : (item as any).metacritic_seasons_json;
  const seasons = parseSeasonLinks(seasonJson);

  if (!seriesHref && seasons.length === 0) return <span className="text-gray-400">-</span>;

  return (
    <div className="space-y-1">
      {seriesHref && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">剧集</span>
          <LinkCell href={seriesHref} label="打开" />
        </div>
      )}
      {seasons.map((s) => (
        <div key={`${platform}-s-${s.season}`} className="flex items-center gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">{`第${s.season}季`}</span>
          <LinkCell href={s.url} label="打开" />
        </div>
      ))}
    </div>
  );
}

export default function AdminMediaLinkMappingPage() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [tmdbIdFilter, setTmdbIdFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);

  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<MediaLinkMappingItem | null>(null);

  const [form, setForm] = useState<Partial<MediaLinkMappingItem>>({});
  const [editDoubanSeasons, setEditDoubanSeasons] = useState<DoubanSeasonEntry[]>([]);
  const [editRtSeasons, setEditRtSeasons] = useState<SeasonUrlEntry[]>([]);
  const [editMtcSeasons, setEditMtcSeasons] = useState<SeasonUrlEntry[]>([]);

  const [mediaQuery, setMediaQuery] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<AdminMediaItem | null>(null);
  const [searchType, setSearchType] = useState<'movie' | 'tv'>('movie');
  const debouncedMediaQuery = useDebounce(mediaQuery, 250);

  const [createDoubanSeasons, setCreateDoubanSeasons] = useState<DoubanSeasonEntry[]>([]);
  const [createRtSeasons, setCreateRtSeasons] = useState<SeasonUrlEntry[]>([]);
  const [createMtcSeasons, setCreateMtcSeasons] = useState<SeasonUrlEntry[]>([]);

  useEffect(() => {
    document.title = '影视链接映射库 - 管理后台 - RateFuse';
  }, []);

  const tmdbIdFilterInt = useMemo(() => {
    const v = (tmdbIdFilter || '').trim();
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }, [tmdbIdFilter]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-media-link-mappings', { keyword, tmdbIdFilterInt, page, pageSize }],
    queryFn: () =>
      fetchMediaLinkMappings({
        q: keyword || undefined,
        tmdb_id: tmdbIdFilterInt,
        page,
        page_size: pageSize,
      }),
  });

  const total = data?.total ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-media-link-mappings'] });
  };

  const { data: mediaSearchData, isFetching: mediaSearching } = useQuery({
    queryKey: ['admin-media-link-search', { q: debouncedMediaQuery }],
    enabled: createOpen && !!debouncedMediaQuery.trim(),
    queryFn: () => adminSearchMedia(debouncedMediaQuery),
  });

  const mediaResults = useMemo(() => {
    const movies = mediaSearchData?.movies?.results || [];
    const tvs = mediaSearchData?.tvShows?.results || [];
    return [...movies, ...tvs] as AdminMediaItem[];
  }, [mediaSearchData]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMedia) throw new Error('请先选择影视');
      const doubanSeasonUrlMap: Record<string, string> = {};
      const doubanSeasonIdMap: Record<string, string> = {};
      for (const row of createDoubanSeasons) {
        if (!row.season_number || !row.url) continue;
        doubanSeasonUrlMap[String(row.season_number)] = row.url;
        if (row.douban_id) doubanSeasonIdMap[String(row.season_number)] = row.douban_id;
      }
      const rtSeasonMap: Record<string, string> = {};
      for (const row of createRtSeasons) {
        if (!row.season_number || !row.url) continue;
        rtSeasonMap[String(row.season_number)] = row.url;
      }
      const mtcSeasonMap: Record<string, string> = {};
      for (const row of createMtcSeasons) {
        if (!row.season_number || !row.url) continue;
        mtcSeasonMap[String(row.season_number)] = row.url;
      }
      return await createMediaLinkMapping({
        tmdb_id: selectedMedia.id,
        media_type: selectedMedia.type as MediaType,
        douban_id: (form.douban_id as any) || null,
        douban_url: (form.douban_url as any) || null,
        douban_seasons_json: Object.keys(doubanSeasonUrlMap).length ? JSON.stringify(doubanSeasonUrlMap) : null,
        douban_seasons_ids_json: Object.keys(doubanSeasonIdMap).length ? JSON.stringify(doubanSeasonIdMap) : null,
        letterboxd_url: (form.letterboxd_url as any) || null,
        letterboxd_slug: (form.letterboxd_slug as any) || null,
        rotten_tomatoes_url: (form.rotten_tomatoes_url as any) || null,
        rotten_tomatoes_slug: (form.rotten_tomatoes_slug as any) || null,
        rotten_tomatoes_seasons_json: Object.keys(rtSeasonMap).length ? JSON.stringify(rtSeasonMap) : null,
        metacritic_url: (form.metacritic_url as any) || null,
        metacritic_slug: (form.metacritic_slug as any) || null,
        metacritic_seasons_json: Object.keys(mtcSeasonMap).length ? JSON.stringify(mtcSeasonMap) : null,
      });
    },
    onSuccess: () => {
      toast.success('已创建映射');
      setCreateOpen(false);
      setSelectedMedia(null);
      setMediaQuery('');
      setForm({});
      refresh();
    },
    onError: (e: any) => toast.error(e?.message || '创建失败'),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error('未选择记录');
      return await updateMediaLinkMapping(editing.id, {
        title: (form.title as any) ?? undefined,
        year: (form.year as any) ?? undefined,
        imdb_id: (form.imdb_id as any) ?? undefined,
        douban_id: (form.douban_id as any) ?? undefined,
        douban_url: (form.douban_url as any) ?? undefined,
        douban_seasons_json: (form.douban_seasons_json as any) ?? undefined,
        douban_seasons_ids_json: (form.douban_seasons_ids_json as any) ?? undefined,
        letterboxd_url: (form.letterboxd_url as any) ?? undefined,
        letterboxd_slug: (form.letterboxd_slug as any) ?? undefined,
        rotten_tomatoes_url: (form.rotten_tomatoes_url as any) ?? undefined,
        rotten_tomatoes_slug: (form.rotten_tomatoes_slug as any) ?? undefined,
        rotten_tomatoes_seasons_json: (form.rotten_tomatoes_seasons_json as any) ?? undefined,
        metacritic_url: (form.metacritic_url as any) ?? undefined,
        metacritic_slug: (form.metacritic_slug as any) ?? undefined,
        metacritic_seasons_json: (form.metacritic_seasons_json as any) ?? undefined,
        confidence: (form.confidence as any) ?? undefined,
        last_verified_at: (form.last_verified_at as any) ?? undefined,
      });
    },
    onSuccess: () => {
      toast.success('已保存');
      setEditOpen(false);
      setEditing(null);
      setForm({});
      refresh();
    },
    onError: (e: any) => toast.error(e?.message || '保存失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => deleteMediaLinkMapping(id),
    onSuccess: () => {
      toast.success('已删除');
      refresh();
    },
    onError: (e: any) => toast.error(e?.message || '删除失败'),
  });

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setKeyword(searchValue.trim());
  };

  const openEdit = (item: MediaLinkMappingItem) => {
    setEditing(item);
    setForm({ ...item });
    if (item.media_type === 'tv') {
      setEditDoubanSeasons(parseDoubanSeasonJson((item as any).douban_seasons_json, (item as any).douban_seasons_ids_json).length
        ? parseDoubanSeasonJson((item as any).douban_seasons_json, (item as any).douban_seasons_ids_json)
        : [{ season_number: 1, url: '', douban_id: '' }]);
      setEditRtSeasons(parseSeasonUrlJson((item as any).rotten_tomatoes_seasons_json).length
        ? parseSeasonUrlJson((item as any).rotten_tomatoes_seasons_json)
        : [{ season_number: 1, url: '' }]);
      setEditMtcSeasons(parseSeasonUrlJson((item as any).metacritic_seasons_json).length
        ? parseSeasonUrlJson((item as any).metacritic_seasons_json)
        : [{ season_number: 1, url: '' }]);
    } else {
      setEditDoubanSeasons([]);
      setEditRtSeasons([]);
      setEditMtcSeasons([]);
    }
    setEditOpen(true);
  };

  const openCreate = () => {
    setForm({});
    setSelectedMedia(null);
    setMediaQuery('');
    setSearchType('movie');
    setCreateDoubanSeasons([]);
    setCreateRtSeasons([]);
    setCreateMtcSeasons([]);
    setCreateOpen(true);
  };

  const filteredCreateItems = useMemo(() => {
    return (mediaResults || []).filter((x) => x.type === searchType);
  }, [mediaResults, searchType]);

  useEffect(() => {
    const urlMap: Record<string, string> = {};
    const idMap: Record<string, string> = {};
    for (const row of createDoubanSeasons) {
      if (!row.season_number || !row.url) continue;
      urlMap[String(row.season_number)] = row.url;
      if (row.douban_id) idMap[String(row.season_number)] = row.douban_id;
    }
    setForm((p: any) => ({
      ...p,
      douban_seasons_json: Object.keys(urlMap).length ? JSON.stringify(urlMap) : '',
      douban_seasons_ids_json: Object.keys(idMap).length ? JSON.stringify(idMap) : '',
    }));
  }, [createDoubanSeasons]);

  useEffect(() => {
    const rtMap: Record<string, string> = {};
    for (const row of createRtSeasons) {
      if (!row.season_number || !row.url) continue;
      rtMap[String(row.season_number)] = row.url;
    }
    setForm((p: any) => ({
      ...p,
      rotten_tomatoes_seasons_json: Object.keys(rtMap).length ? JSON.stringify(rtMap) : '',
    }));
  }, [createRtSeasons]);

  useEffect(() => {
    const mtcMap: Record<string, string> = {};
    for (const row of createMtcSeasons) {
      if (!row.season_number || !row.url) continue;
      mtcMap[String(row.season_number)] = row.url;
    }
    setForm((p: any) => ({
      ...p,
      metacritic_seasons_json: Object.keys(mtcMap).length ? JSON.stringify(mtcMap) : '',
    }));
  }, [createMtcSeasons]);

  useEffect(() => {
    if (!editing || editing.media_type !== 'tv') return;
    const urlMap: Record<string, string> = {};
    const idMap: Record<string, string> = {};
    for (const row of editDoubanSeasons) {
      if (!row.season_number || !row.url) continue;
      urlMap[String(row.season_number)] = row.url;
      if (row.douban_id) idMap[String(row.season_number)] = row.douban_id;
    }
    setForm((p: any) => ({
      ...p,
      douban_seasons_json: Object.keys(urlMap).length ? JSON.stringify(urlMap) : '',
      douban_seasons_ids_json: Object.keys(idMap).length ? JSON.stringify(idMap) : '',
    }));
  }, [editDoubanSeasons, editing?.id, editing?.media_type]);

  useEffect(() => {
    if (!editing || editing.media_type !== 'tv') return;
    const rtMap: Record<string, string> = {};
    for (const row of editRtSeasons) {
      if (!row.season_number || !row.url) continue;
      rtMap[String(row.season_number)] = row.url;
    }
    setForm((p: any) => ({
      ...p,
      rotten_tomatoes_seasons_json: Object.keys(rtMap).length ? JSON.stringify(rtMap) : '',
    }));
  }, [editRtSeasons, editing?.id, editing?.media_type]);

  useEffect(() => {
    if (!editing || editing.media_type !== 'tv') return;
    const mtcMap: Record<string, string> = {};
    for (const row of editMtcSeasons) {
      if (!row.season_number || !row.url) continue;
      mtcMap[String(row.season_number)] = row.url;
    }
    setForm((p: any) => ({
      ...p,
      metacritic_seasons_json: Object.keys(mtcMap).length ? JSON.stringify(mtcMap) : '',
    }));
  }, [editMtcSeasons, editing?.id, editing?.media_type]);

  useEffect(() => {
    if (selectedMedia?.type !== 'tv') {
      setCreateDoubanSeasons([]);
      setCreateRtSeasons([]);
      setCreateMtcSeasons([]);
      return;
    }
    const dbRows = parseDoubanSeasonJson((form as any).douban_seasons_json, (form as any).douban_seasons_ids_json);
    const rtRows = parseSeasonUrlJson((form as any).rotten_tomatoes_seasons_json);
    const mtcRows = parseSeasonUrlJson((form as any).metacritic_seasons_json);
    setCreateDoubanSeasons(dbRows.length ? dbRows : [{ season_number: 1, url: '', douban_id: '' }]);
    setCreateRtSeasons(rtRows.length ? rtRows : [{ season_number: 1, url: '' }]);
    setCreateMtcSeasons(mtcRows.length ? mtcRows : [{ season_number: 1, url: '' }]);
  }, [selectedMedia?.id, selectedMedia?.type]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">
            影视链接映射库
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            首次匹配后持久化各平台链接/ID，后续优先走映射直接抓取，减少重复搜索
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="no-hover-scale"
            onClick={refresh}
            disabled={isFetching}
          >
            刷新
          </Button>
          <Button type="button" onClick={openCreate} className="no-hover-scale">
            新建
          </Button>
        </div>
      </div>

      <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Input
          label="名称模糊搜索"
          placeholder="输入影视名称关键字"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
        />
        <Input
          label="TMDB ID 精确筛选"
          placeholder="例如 157336"
          value={tmdbIdFilter}
          onChange={(e) => setTmdbIdFilter(e.target.value)}
        />
        <div className="flex items-end gap-2">
          <Button type="submit" className="h-11 no-hover-scale" disabled={isFetching}>
            {isFetching ? '搜索中...' : '搜索'}
          </Button>
          <div className="ml-auto">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Page size
            </label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPage(1);
                setPageSize(Number(e.target.value) as PageSize);
              }}
              className="block w-28 rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 text-sm h-11"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/80">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">影视名称</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">TMDB</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">类型</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Douban</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">LB</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">RT</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">MTC</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">状态</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">更新时间</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                  加载中...
                </td>
              </tr>
            ) : (data?.items?.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                  暂无数据
                </td>
              </tr>
            ) : (
              data!.items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50/80 dark:hover:bg-gray-800/60"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {item.title || '（未填写）'} {item.year != null ? `(${item.year})` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{item.tmdb_id}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
                      {item.media_type === 'movie' ? 'movie' : 'tv'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <PlatformLinksCell item={item} platform="douban" />
                  </td>
                  <td className="px-4 py-3">
                    <LinkCell href={buildPlatformLink(item, 'letterboxd')} label="打开" />
                  </td>
                  <td className="px-4 py-3">
                    <PlatformLinksCell item={item} platform="rottentomatoes" />
                  </td>
                  <td className="px-4 py-3">
                    <PlatformLinksCell item={item} platform="metacritic" />
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                        item.match_status === 'manual'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                          : item.match_status === 'conflict'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      }`}
                    >
                      {item.match_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {formatBeijingDateTime(item.updated_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="no-hover-scale px-2 py-1 text-xs"
                        onClick={() => openEdit(item)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="no-hover-scale px-2 py-1 text-xs"
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      <Dialog
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          setEditing(null);
          setForm({});
        }}
        title={`编辑映射（ID: ${editing?.id ?? ''}）`}
      >
        <div className="space-y-3">
          {editing?.media_type === 'movie' ? (
            <>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {editing?.title || '（未填写）'} {editing?.year != null ? `(${editing?.year})` : ''} · TMDB {editing?.tmdb_id}
              </div>

              <Input
                label="豆瓣评分链接"
                value={String(form.douban_url ?? '')}
                onChange={(e) => {
                  const url = e.target.value;
                  const doubanId = extractDoubanIdFromUrl(url);
                  setForm((p) => ({ ...p, douban_url: url, douban_id: doubanId ?? (p as any).douban_id }));
                }}
                placeholder="https://movie.douban.com/subject/xxxx/"
              />
              <Input
                label="豆瓣ID"
                value={String(form.douban_id ?? '')}
                onChange={(e) => setForm((p) => ({ ...p, douban_id: e.target.value }))}
                placeholder="1234567"
              />

              <Input
                label="Rotten Tomatoes 评分链接"
                value={String((form as any).rotten_tomatoes_url ?? '')}
                onChange={(e) => {
                  const url = e.target.value;
                  const slug = extractRtSlugFromUrl(url);
                  setForm((p: any) => ({ ...p, rotten_tomatoes_url: url, rotten_tomatoes_slug: slug ?? p.rotten_tomatoes_slug }));
                }}
                placeholder="https://www.rottentomatoes.com/m/xxx"
              />
              <Input
                label="Rotten Tomatoes Slug"
                value={String(form.rotten_tomatoes_slug ?? '')}
                onChange={(e) => setForm((p) => ({ ...p, rotten_tomatoes_slug: e.target.value }))}
                placeholder="m/interstellar_2014"
              />

              <Input
                label="Metacritic 评分链接"
                value={String((form as any).metacritic_url ?? '')}
                onChange={(e) => {
                  const url = e.target.value;
                  const slug = extractMetacriticSlugFromUrl(url);
                  setForm((p: any) => ({ ...p, metacritic_url: url, metacritic_slug: slug ?? p.metacritic_slug }));
                }}
                placeholder="https://www.metacritic.com/movie/xxx/"
              />
              <Input
                label="Metacritic Slug"
                value={String(form.metacritic_slug ?? '')}
                onChange={(e) => setForm((p) => ({ ...p, metacritic_slug: e.target.value }))}
                placeholder="movie/interstellar"
              />

              <Input
                label="Letterboxd 评分链接"
                value={String((form as any).letterboxd_url ?? '')}
                onChange={(e) => {
                  const url = e.target.value;
                  const slug = extractLetterboxdSlugFromUrl(url);
                  setForm((p: any) => ({ ...p, letterboxd_url: url, letterboxd_slug: slug ?? p.letterboxd_slug }));
                }}
                placeholder="https://letterboxd.com/film/xxx/"
              />
              <Input
                label="Letterboxd Slug"
                value={String(form.letterboxd_slug ?? '')}
                onChange={(e) => setForm((p) => ({ ...p, letterboxd_slug: e.target.value }))}
                placeholder="interstellar"
              />
            </>
          ) : editing?.media_type === 'tv' ? (
            <>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {editing?.title || '（未填写）'} {editing?.year != null ? `(${editing?.year})` : ''} · TMDB {editing?.tmdb_id}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">豆瓣分季</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="no-hover-scale"
                    onClick={() =>
                      setEditDoubanSeasons((prev) => {
                        const next = (prev.reduce((m, x) => Math.max(m, Number(x.season_number) || 0), 0) || 0) + 1;
                        return [...prev, { season_number: next, url: '', douban_id: '' }];
                      })
                    }
                  >
                    + 添加一季
                  </Button>
                </div>
                <div className="hidden sm:grid sm:grid-cols-[72px_minmax(0,1fr)_140px_92px] gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <div>季</div>
                  <div>豆瓣分季评分链接</div>
                  <div>豆瓣分季ID</div>
                  <div className="text-right">操作</div>
                </div>
                {editDoubanSeasons.map((row, idx) => (
                  <div key={`edit-db-s-${idx}`} className="grid grid-cols-1 sm:grid-cols-[72px_minmax(0,1fr)_140px_92px] gap-2 items-end">
                    <Input label={idx === 0 ? '季' : undefined} value={String(row.season_number)} readOnly className="text-center" />
                    <Input
                      label={idx === 0 ? '豆瓣分季评分链接' : undefined}
                      value={row.url}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditDoubanSeasons((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, url: v, douban_id: extractDoubanIdFromUrl(v) || x.douban_id } : x))
                        );
                      }}
                      placeholder="https://movie.douban.com/subject/xxxx/"
                    />
                    <Input
                      label={idx === 0 ? '豆瓣分季ID' : undefined}
                      value={row.douban_id}
                      onChange={(e) =>
                        setEditDoubanSeasons((prev) => prev.map((x, i) => (i === idx ? { ...x, douban_id: e.target.value } : x)))
                      }
                      placeholder="1234567"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="no-hover-scale h-10 self-end whitespace-nowrap"
                      onClick={() => setEditDoubanSeasons((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>

              <Input
                label="Rotten Tomatoes 剧集评分链接"
                value={String((form as any).rotten_tomatoes_url ?? '')}
                onChange={(e) => {
                  const url = e.target.value;
                  const slug = extractRtSlugFromUrl(url);
                  setForm((p: any) => ({ ...p, rotten_tomatoes_url: url, rotten_tomatoes_slug: slug ?? p.rotten_tomatoes_slug }));
                }}
                placeholder="https://www.rottentomatoes.com/tv/xxx"
              />
              <Input
                label="Rotten Tomatoes 剧集 Slug"
                value={String(form.rotten_tomatoes_slug ?? '')}
                onChange={(e) => setForm((p) => ({ ...p, rotten_tomatoes_slug: e.target.value }))}
                placeholder="tv/xxx"
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Rotten Tomatoes 分季</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="no-hover-scale"
                    onClick={() =>
                      setEditRtSeasons((prev) => {
                        const next = (prev.reduce((m, x) => Math.max(m, Number(x.season_number) || 0), 0) || 0) + 1;
                        return [...prev, { season_number: next, url: '' }];
                      })
                    }
                  >
                    + 添加一季
                  </Button>
                </div>
                <div className="hidden sm:grid sm:grid-cols-[72px_minmax(0,1fr)_92px] gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <div>季</div>
                  <div>分季评分链接</div>
                  <div className="text-right">操作</div>
                </div>
                {editRtSeasons.map((row, idx) => (
                  <div key={`edit-rt-s-${idx}`} className="grid grid-cols-1 sm:grid-cols-[72px_minmax(0,1fr)_92px] gap-2 items-end">
                    <Input label={idx === 0 ? '季' : undefined} value={String(row.season_number)} readOnly className="text-center" />
                    <Input
                      label={idx === 0 ? '分季评分链接' : undefined}
                      value={row.url}
                      onChange={(e) => setEditRtSeasons((prev) => prev.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)))}
                      placeholder="https://www.rottentomatoes.com/tv/xxx/sxx"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="no-hover-scale h-10 self-end whitespace-nowrap"
                      onClick={() => setEditRtSeasons((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>

              <Input
                label="Metacritic 剧集评分链接"
                value={String((form as any).metacritic_url ?? '')}
                onChange={(e) => {
                  const url = e.target.value;
                  const slug = extractMetacriticSlugFromUrl(url);
                  setForm((p: any) => ({ ...p, metacritic_url: url, metacritic_slug: slug ?? p.metacritic_slug }));
                }}
                placeholder="https://www.metacritic.com/tv/xxx/"
              />
              <Input
                label="Metacritic Slug"
                value={String(form.metacritic_slug ?? '')}
                onChange={(e) => setForm((p) => ({ ...p, metacritic_slug: e.target.value }))}
                placeholder="tv/xxx"
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Metacritic 分季</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="no-hover-scale"
                    onClick={() =>
                      setEditMtcSeasons((prev) => {
                        const next = (prev.reduce((m, x) => Math.max(m, Number(x.season_number) || 0), 0) || 0) + 1;
                        return [...prev, { season_number: next, url: '' }];
                      })
                    }
                  >
                    + 添加一季
                  </Button>
                </div>
                <div className="hidden sm:grid sm:grid-cols-[72px_minmax(0,1fr)_92px] gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <div>季</div>
                  <div>分季评分链接</div>
                  <div className="text-right">操作</div>
                </div>
                {editMtcSeasons.map((row, idx) => (
                  <div key={`edit-mtc-s-${idx}`} className="grid grid-cols-1 sm:grid-cols-[72px_minmax(0,1fr)_92px] gap-2 items-end">
                    <Input label={idx === 0 ? '季' : undefined} value={String(row.season_number)} readOnly className="text-center" />
                    <Input
                      label={idx === 0 ? '分季评分链接' : undefined}
                      value={row.url}
                      onChange={(e) => setEditMtcSeasons((prev) => prev.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)))}
                      placeholder="https://www.metacritic.com/tv/xxx/season-1/"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="no-hover-scale h-10 self-end whitespace-nowrap"
                      onClick={() => setEditMtcSeasons((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>

              <Input
                label="Letterboxd 剧集评分链接"
                value={String((form as any).letterboxd_url ?? '')}
                onChange={(e) => {
                  const url = e.target.value;
                  const slug = extractLetterboxdSlugFromUrl(url);
                  setForm((p: any) => ({ ...p, letterboxd_url: url, letterboxd_slug: slug ?? p.letterboxd_slug }));
                }}
                placeholder="https://letterboxd.com/film/xxx/"
              />
              <Input
                label="Letterboxd Slug"
                value={String(form.letterboxd_slug ?? '')}
                onChange={(e) => setForm((p) => ({ ...p, letterboxd_slug: e.target.value }))}
                placeholder="xxxx"
              />
            </>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="no-hover-scale"
              onClick={() => {
                setEditOpen(false);
                setEditing(null);
                setForm({});
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              className="no-hover-scale"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setSelectedMedia(null);
          setMediaQuery('');
          setForm({});
        }}
        title="新建映射"
      >
        <div className="space-y-3">
          <div>
            <div className="mb-2">
              <CardTabs
                tabs={[
                  { id: 'movie', label: '电影' },
                  { id: 'tv', label: '剧集' },
                ]}
                activeId={searchType}
                onChange={(id) => {
                  setSelectedMedia(null);
                  setSearchType(id as any);
                }}
              />
            </div>
            <Input
              label="选择影视（支持：名称+年份 / IMDB ID / TMDB ID）"
              placeholder={searchType === 'movie' ? '搜索电影...' : '搜索剧集...'}
              value={mediaQuery}
              onChange={(e) => setMediaQuery(e.target.value)}
            />
          </div>

          <AdminMediaSearchResults
            items={filteredCreateItems}
            selectedItem={selectedMedia}
            onSelect={(it) => setSelectedMedia(it)}
            onClearSelection={() => setSelectedMedia(null)}
            emptyMessage={mediaQuery.trim().length > 0 ? (mediaSearching ? '搜索中...' : '暂无匹配结果') : undefined}
          />

          {selectedMedia?.type === 'movie' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="豆瓣评分链接"
                  value={String(form.douban_url ?? '')}
                  onChange={(e) => {
                    const url = e.target.value;
                    const id = extractDoubanIdFromUrl(url);
                    setForm((p: any) => ({ ...p, douban_url: url, douban_id: id ?? p.douban_id }));
                  }}
                />
                <Input
                  label="豆瓣ID"
                  value={String(form.douban_id ?? '')}
                  onChange={(e) => setForm((p) => ({ ...p, douban_id: e.target.value }))}
                />
                <Input
                  label="Rotten Tomatoes评分链接"
                  value={String((form as any).rotten_tomatoes_url ?? '')}
                  onChange={(e) => {
                    const url = e.target.value;
                    const slug = extractRtSlugFromUrl(url);
                    setForm((p: any) => ({ ...p, rotten_tomatoes_url: url, rotten_tomatoes_slug: slug ?? p.rotten_tomatoes_slug }));
                  }}
                />
                <Input
                  label="Rotten Tomatoes Slug"
                  placeholder="m/interstellar_2014"
                  value={String(form.rotten_tomatoes_slug ?? '')}
                  onChange={(e) => setForm((p) => ({ ...p, rotten_tomatoes_slug: e.target.value }))}
                />
                <Input
                  label="Metacritic评分链接"
                  value={String((form as any).metacritic_url ?? '')}
                  onChange={(e) => {
                    const url = e.target.value;
                    const slug = extractMetacriticSlugFromUrl(url);
                    setForm((p: any) => ({ ...p, metacritic_url: url, metacritic_slug: slug ?? p.metacritic_slug }));
                  }}
                />
                <Input
                  label="Metacritic Slug"
                  placeholder="movie/interstellar"
                  value={String(form.metacritic_slug ?? '')}
                  onChange={(e) => setForm((p) => ({ ...p, metacritic_slug: e.target.value }))}
                />
                <Input
                  label="Letterboxd评分链接"
                  value={String((form as any).letterboxd_url ?? '')}
                  onChange={(e) => {
                    const url = e.target.value;
                    const slug = extractLetterboxdSlugFromUrl(url);
                    setForm((p: any) => ({ ...p, letterboxd_url: url, letterboxd_slug: slug ?? p.letterboxd_slug }));
                  }}
                />
                <Input
                  label="Letterboxd Slug"
                  placeholder="interstellar"
                  value={String(form.letterboxd_slug ?? '')}
                  onChange={(e) => setForm((p) => ({ ...p, letterboxd_slug: e.target.value }))}
                />
              </div>
            </>
          ) : selectedMedia?.type === 'tv' ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">豆瓣分季</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="no-hover-scale"
                    onClick={() =>
                      setCreateDoubanSeasons((prev) => {
                        const next = (prev.reduce((m, x) => Math.max(m, Number(x.season_number) || 0), 0) || 0) + 1;
                        return [...prev, { season_number: next, url: '', douban_id: '' }];
                      })
                    }
                  >
                    + 添加一季
                  </Button>
                </div>
                {createDoubanSeasons.map((row, idx) => (
                  <div key={`db-s-${idx}`} className="grid grid-cols-1 sm:grid-cols-[72px_minmax(0,1fr)_140px_92px] gap-2 items-end">
                    <Input
                      label={idx === 0 ? '季' : undefined}
                      value={String(row.season_number)}
                      readOnly
                      className="text-center"
                    />
                    <Input
                      label={idx === 0 ? '豆瓣分季评分链接' : undefined}
                      value={row.url}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCreateDoubanSeasons((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, url: v, douban_id: extractDoubanIdFromUrl(v) || x.douban_id } : x
                          )
                        );
                      }}
                      placeholder="https://movie.douban.com/subject/xxxx/"
                    />
                    <Input
                      label={idx === 0 ? '豆瓣分季ID' : undefined}
                      value={row.douban_id}
                      onChange={(e) =>
                        setCreateDoubanSeasons((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, douban_id: e.target.value } : x))
                        )
                      }
                      placeholder="1234567"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="no-hover-scale h-10 self-end whitespace-nowrap"
                      onClick={() => setCreateDoubanSeasons((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Rotten Tomatoes剧集评分链接"
                  value={String((form as any).rotten_tomatoes_url ?? '')}
                  onChange={(e) => {
                    const url = e.target.value;
                    const slug = extractRtSlugFromUrl(url);
                    setForm((p: any) => ({ ...p, rotten_tomatoes_url: url, rotten_tomatoes_slug: slug ?? p.rotten_tomatoes_slug }));
                  }}
                />
                <Input
                  label="Rotten Tomatoes剧集 Slug"
                  placeholder="tv/the_last_of_us"
                  value={String(form.rotten_tomatoes_slug ?? '')}
                  onChange={(e) => setForm((p) => ({ ...p, rotten_tomatoes_slug: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Rotten Tomatoes 分季</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="no-hover-scale"
                    onClick={() =>
                      setCreateRtSeasons((prev) => {
                        const next = (prev.reduce((m, x) => Math.max(m, Number(x.season_number) || 0), 0) || 0) + 1;
                        return [...prev, { season_number: next, url: '' }];
                      })
                    }
                  >
                    + 添加一季
                  </Button>
                </div>
                {createRtSeasons.map((row, idx) => (
                  <div key={`rt-s-${idx}`} className="grid grid-cols-1 sm:grid-cols-[72px_minmax(0,1fr)_92px] gap-2 items-end">
                    <Input
                      label={idx === 0 ? '季' : undefined}
                      value={String(row.season_number)}
                      readOnly
                      className="text-center"
                    />
                    <Input
                      label={idx === 0 ? '分季评分链接' : undefined}
                      value={row.url}
                      onChange={(e) =>
                        setCreateRtSeasons((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x))
                        )
                      }
                      placeholder="https://www.rottentomatoes.com/tv/xxx/s01"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="no-hover-scale h-10 self-end whitespace-nowrap"
                      onClick={() => setCreateRtSeasons((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Metacritic剧集评分链接"
                  value={String((form as any).metacritic_url ?? '')}
                  onChange={(e) => {
                    const url = e.target.value;
                    const slug = extractMetacriticSlugFromUrl(url);
                    setForm((p: any) => ({ ...p, metacritic_url: url, metacritic_slug: slug ?? p.metacritic_slug }));
                  }}
                />
                <Input
                  label="Metacritic Slug"
                  placeholder="tv/the-last-of-us"
                  value={String(form.metacritic_slug ?? '')}
                  onChange={(e) => setForm((p) => ({ ...p, metacritic_slug: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Metacritic 分季</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="no-hover-scale"
                    onClick={() =>
                      setCreateMtcSeasons((prev) => {
                        const next = (prev.reduce((m, x) => Math.max(m, Number(x.season_number) || 0), 0) || 0) + 1;
                        return [...prev, { season_number: next, url: '' }];
                      })
                    }
                  >
                    + 添加一季
                  </Button>
                </div>
                {createMtcSeasons.map((row, idx) => (
                  <div key={`mtc-s-${idx}`} className="grid grid-cols-1 sm:grid-cols-[72px_minmax(0,1fr)_92px] gap-2 items-end">
                    <Input
                      label={idx === 0 ? '季' : undefined}
                      value={String(row.season_number)}
                      readOnly
                      className="text-center"
                    />
                    <Input
                      label={idx === 0 ? '分季评分链接' : undefined}
                      value={row.url}
                      onChange={(e) =>
                        setCreateMtcSeasons((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x))
                        )
                      }
                      placeholder="https://www.metacritic.com/tv/xxx/season-1/"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="no-hover-scale h-10 self-end whitespace-nowrap"
                      onClick={() => setCreateMtcSeasons((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Letterboxd剧集评分链接"
                  value={String((form as any).letterboxd_url ?? '')}
                  onChange={(e) => {
                    const url = e.target.value;
                    const slug = extractLetterboxdSlugFromUrl(url);
                    setForm((p: any) => ({ ...p, letterboxd_url: url, letterboxd_slug: slug ?? p.letterboxd_slug }));
                  }}
                />
                <Input
                  label="Letterboxd Slug"
                  value={String(form.letterboxd_slug ?? '')}
                  onChange={(e) => setForm((p) => ({ ...p, letterboxd_slug: e.target.value }))}
                />
              </div>
            </>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="no-hover-scale"
              onClick={() => {
                setCreateOpen(false);
                setSelectedMedia(null);
                setMediaQuery('');
                setForm({});
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              className="no-hover-scale"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? '创建中...' : '创建'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
