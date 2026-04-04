// ==========================================
// 管理端评分编辑页
// ==========================================
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '../../shared/hooks/useDebounce';
import { useMediaRatings } from '../../modules/rating/useMediaRatings';
import { Input } from '../../shared/ui/Input';
import { Button } from '../../shared/ui/Button';
import { CardTabs } from '../../shared/ui/CardTabs';
import { AdminMediaSearchResults } from '../../modules/admin/AdminMediaSearchResults';
import { adminSearchMedia } from '../../api/adminSearch';
import { Search } from 'lucide-react';
import { toast } from 'sonner';

interface MediaItem {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  poster: string;
  year?: number;
}

const PLATFORMS = ['豆瓣', 'IMDb', 'Rotten Tomatoes', 'Metacritic', 'Letterboxd', 'TMDB', 'Trakt'] as const;
const SEASON_PLATFORMS = ['豆瓣', 'Rotten Tomatoes', 'Metacritic', 'TMDB', 'Trakt'];
const PLATFORM_TO_KEY: Record<string, string> = {
  '豆瓣': 'douban',
  'IMDb': 'imdb',
  'Letterboxd': 'letterboxd',
  'Rotten Tomatoes': 'rottentomatoes',
  'Metacritic': 'metacritic',
  'TMDB': 'tmdb',
  'Trakt': 'trakt',
};

function extractValue(obj: unknown, ...paths: string[]): string {
  if (obj == null) return '';
  let cur: any = obj;
  for (const p of paths) {
    cur = cur?.[p];
    if (cur == null) return '';
  }
  return String(cur ?? '');
}

interface SeasonEntry {
  season_number: number;
  [key: string]: string | number;
}

interface PlatformSeasonData {
  seasons?: Array<Record<string, unknown>>;
  series?: {
    seasons?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function getSeasonsFromPlatformData(platformKey: string, data: PlatformSeasonData | null): SeasonEntry[] {
  if (!data) return [];
  const arr = data.seasons || data.series?.seasons;
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => {
    const sn = Number(s.season_number) || 0;
    const base: SeasonEntry = { season_number: sn };
    base.url = extractValue(s, 'url');
    if (platformKey === 'douban') {
      base.rating = extractValue(s, 'rating');
      base.rating_people = extractValue(s, 'rating_people');
    } else if (platformKey === 'rottentomatoes') {
      base.tomatometer = extractValue(s, 'tomatometer');
      base.audience_score = extractValue(s, 'audience_score');
      base.critics_count = extractValue(s, 'critics_count');
      base.audience_count = extractValue(s, 'audience_count');
    } else if (platformKey === 'metacritic') {
      base.metascore = extractValue(s, 'metascore');
      base.userscore = extractValue(s, 'userscore');
      base.critics_count = extractValue(s, 'critics_count');
      base.users_count = extractValue(s, 'users_count');
    } else if (platformKey === 'tmdb') {
      base.rating = extractValue(s, 'rating');
      base.vote_count = extractValue(s, 'voteCount');
    } else if (platformKey === 'trakt') {
      base.rating = extractValue(s, 'rating');
      base.votes = extractValue(s, 'votes');
    }
    return base;
  });
}

export default function AdminRatingEditPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'movie' | 'tv'>('movie');
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [activePlatform, setActivePlatform] = useState<string>(PLATFORMS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [seasons, setSeasons] = useState<SeasonEntry[]>([]);

  useEffect(() => {
    setSeasons([]);
  }, [activePlatform, selectedMedia?.id]);

  useEffect(() => {
    document.title = '评分数据修改（管理员） - RateFuse';
  }, []);

  const debouncedQuery = useDebounce(searchQuery, 350);
  const { data: searchData } = useQuery({
    queryKey: ['admin-rating-edit-search', debouncedQuery],
    queryFn: () => adminSearchMedia(debouncedQuery),
    enabled: !!debouncedQuery,
  });

  const {
    platformStatuses,
    tmdbRating,
    traktRating,
    tmdbStatus,
    traktStatus,
  } = useMediaRatings({
    mediaId: selectedMedia ? String(selectedMedia.id) : undefined,
    mediaType: selectedMedia?.type ?? 'movie',
  });

  const loadingRatings = selectedMedia && (
    Object.values(platformStatuses).some((s) => s.status === 'loading') ||
    tmdbStatus === 'loading' ||
    traktStatus === 'loading'
  );

  const movies = searchData?.movies?.results ?? [];
  const tvs = searchData?.tvShows?.results ?? [];
  const filteredItems = (searchType === 'movie' ? movies : tvs).slice(0, 12);

  function getPlatformData(platformKey: string): PlatformSeasonData | null {
    if (platformKey === 'tmdb' && tmdbRating) {
      return { rating: tmdbRating.rating, voteCount: tmdbRating.voteCount };
    }
    if (platformKey === 'trakt' && traktRating) {
      return { rating: traktRating.rating, votes: traktRating.votes };
    }
    const s = platformStatuses[platformKey as keyof typeof platformStatuses];
    if (s?.data && s.status === 'successful') {
      const d = s.data as PlatformSeasonData;
      return (d.data as PlatformSeasonData) ?? d;
    }
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMedia) return;
    setSubmitting(true);
    try {
      const platformKey = PLATFORM_TO_KEY[activePlatform];
      const form = e.target as HTMLFormElement;
      const formData = new FormData(form);

      const payload: Record<string, unknown> = {
        tmdb_id: selectedMedia.id,
        media_type: selectedMedia.type,
        platform: platformKey,
      };

      switch (platformKey) {
        case 'douban':
          payload.rating = formData.get('rating');
          payload.rating_people = formData.get('rating_people');
          payload.url = formData.get('url');
          break;
        case 'imdb':
          payload.rating = formData.get('rating');
          payload.rating_people = formData.get('rating_people');
          payload.url = formData.get('url');
          break;
        case 'letterboxd':
          payload.rating = formData.get('rating');
          payload.rating_count = formData.get('rating_count');
          payload.url = formData.get('url');
          break;
        case 'rottentomatoes':
          payload.tomatometer = formData.get('tomatometer');
          payload.audience_score = formData.get('audience_score');
          payload.critics_avg = formData.get('critics_avg');
          payload.audience_avg = formData.get('audience_avg');
          payload.critics_count = formData.get('critics_count');
          payload.audience_count = formData.get('audience_count');
          payload.url = formData.get('url');
          break;
        case 'metacritic':
          payload.metascore = formData.get('metascore');
          payload.userscore = formData.get('userscore');
          payload.critics_count = formData.get('critics_count');
          payload.users_count = formData.get('users_count');
          payload.url = formData.get('url');
          break;
        case 'tmdb':
          payload.rating = formData.get('rating');
          payload.vote_count = formData.get('vote_count');
          payload.url = formData.get('url');
          break;
        case 'trakt':
          payload.rating = formData.get('rating');
          payload.votes = formData.get('votes');
          payload.url = formData.get('url');
          break;
      }
      const isTvSeason = selectedMedia.type === 'tv' && SEASON_PLATFORMS.includes(activePlatform);
      const initSeasons = isTvSeason ? getSeasonsFromPlatformData(platformKey, getPlatformData(platformKey)) : [];
      const dispSeasons = seasons.length > 0 ? seasons : initSeasons;
      if (selectedMedia.type === 'tv' && dispSeasons.length > 0) {
        payload.seasons = dispSeasons.map((s) => {
          const base: Record<string, unknown> = { season_number: s.season_number, url: s.url ?? '' };
          if (platformKey === 'douban') {
            base.rating = s.rating ?? '';
            base.rating_people = s.rating_people ?? '';
          } else if (platformKey === 'rottentomatoes') {
            base.tomatometer = s.tomatometer ?? '';
            base.audience_score = s.audience_score ?? '';
            base.critics_count = s.critics_count ?? '';
            base.audience_count = s.audience_count ?? '';
          } else if (platformKey === 'metacritic') {
            base.metascore = s.metascore ?? '';
            base.userscore = s.userscore ?? '';
            base.critics_count = s.critics_count ?? '';
            base.users_count = s.users_count ?? '';
          } else if (platformKey === 'tmdb') {
            base.rating = s.rating ?? '';
            base.vote_count = s.vote_count ?? '';
          } else if (platformKey === 'trakt') {
            base.rating = s.rating ?? '';
            base.votes = s.votes ?? '';
          }
          return base;
        });
      }

      const res = await fetch(
        `/api/admin/ratings/manual/${selectedMedia.type}/${selectedMedia.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
          },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.detail || err?.message || `HTTP ${res.status}`;
        toast.error(`保存失败: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
        return;
      }
      toast.success('修改成功');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const platformKey = PLATFORM_TO_KEY[activePlatform];
  const platformData = getPlatformData(platformKey);
  const initialSeasons = selectedMedia?.type === 'tv' && SEASON_PLATFORMS.includes(activePlatform)
    ? getSeasonsFromPlatformData(platformKey, platformData)
    : [];
  const displaySeasons = seasons.length > 0 ? seasons : initialSeasons;
  const addSeason = () => {
    const next = displaySeasons.length
      ? Math.max(...displaySeasons.map((x) => Number(x.season_number) || 0)) + 1
      : 1;
    setSeasons((p) => [...(p.length ? p : initialSeasons), { season_number: next }]);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">
        评分数据修改
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        搜索影视，加载现有评分后修改。剧集支持分季评分。请确保 Redis 已启动，否则无法持久化。
      </p>

      <div className="space-y-6">
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4">
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
                setSearchType(id as 'movie' | 'tv');
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

        {selectedMedia && (
          <>
            {loadingRatings ? (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent mx-auto mb-2" />
                <p className="text-gray-500 dark:text-gray-400">加载评分数据...</p>
              </div>
            ) : (
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4">
                <h2 className="font-semibold text-gray-900 dark:text-white mb-3">2. 选择平台并修改</h2>
                <CardTabs
                  tabs={PLATFORMS.map((p) => ({ id: p, label: p }))}
                  activeId={activePlatform}
                  onChange={(id) => setActivePlatform(id)}
                  className="mb-4"
                />
                <form onSubmit={handleSubmit} className="space-y-4">
                  {activePlatform === '豆瓣' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="评分"
                        name="rating"
                        placeholder="如 8.5"
                        defaultValue={extractValue(platformData, 'rating')}
                      />
                      <Input
                        label="评分人数"
                        name="rating_people"
                        placeholder="如 100000"
                        defaultValue={extractValue(platformData, 'rating_people')}
                      />
                      <Input
                        label="评分链接"
                        name="url"
                        placeholder="如 https://movie.douban.com/subject/xxx"
                        defaultValue={extractValue(platformData, 'url')}
                      />
                    </div>
                  )}
                  {activePlatform === 'IMDb' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="评分"
                        name="rating"
                        placeholder="如 8.5"
                        defaultValue={extractValue(platformData, 'rating')}
                      />
                      <Input
                        label="评分人数"
                        name="rating_people"
                        placeholder="如 1000000"
                        defaultValue={extractValue(platformData, 'rating_people')}
                      />
                      <Input
                        label="评分链接"
                        name="url"
                        placeholder="如 https://www.imdb.com/title/ttxxxxxxx/"
                        defaultValue={extractValue(platformData, 'url')}
                      />
                    </div>
                  )}
                  {activePlatform === 'Letterboxd' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="评分"
                        name="rating"
                        placeholder="如 3.8"
                        defaultValue={extractValue(platformData, 'rating')}
                      />
                      <Input
                        label="评分人数"
                        name="rating_count"
                        placeholder="如 50000"
                        defaultValue={extractValue(platformData, 'rating_count')}
                      />
                      <Input
                        label="评分链接"
                        name="url"
                        placeholder="如 https://letterboxd.com/film/xxxxxx/"
                        defaultValue={extractValue(platformData, 'url')}
                      />
                    </div>
                  )}
                  {activePlatform === 'Rotten Tomatoes' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="番茄计"
                        name="tomatometer"
                        defaultValue={extractValue(platformData, 'series', 'tomatometer')}
                      />
                      <Input
                        label="爆米花"
                        name="audience_score"
                        defaultValue={extractValue(platformData, 'series', 'audience_score')}
                      />
                      <Input
                        label="平均新鲜度（专业均分）"
                        name="critics_avg"
                        placeholder="如 7.8/10 或 3.9/5"
                        defaultValue={extractValue(platformData, 'series', 'critics_avg')}
                      />
                      <Input
                        label="平均评分（观众均分）"
                        name="audience_avg"
                        placeholder="如 4.2/5"
                        defaultValue={extractValue(platformData, 'series', 'audience_avg')}
                      />
                      <Input
                        label="影评人数"
                        name="critics_count"
                        defaultValue={extractValue(platformData, 'series', 'critics_count')}
                      />
                      <Input
                        label="观众人数"
                        name="audience_count"
                        defaultValue={extractValue(platformData, 'series', 'audience_count')}
                      />
                      <Input
                        label="评分链接"
                        name="url"
                        placeholder="如 https://www.rottentomatoes.com/m/xxxxxx"
                        defaultValue={extractValue(platformData, 'url')}
                      />
                    </div>
                  )}
                  {activePlatform === 'Metacritic' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="Metascore"
                        name="metascore"
                        defaultValue={extractValue(platformData, 'overall', 'metascore')}
                      />
                      <Input
                        label="User Score"
                        name="userscore"
                        defaultValue={extractValue(platformData, 'overall', 'userscore')}
                      />
                      <Input
                        label="影评人数"
                        name="critics_count"
                        defaultValue={extractValue(platformData, 'overall', 'critics_count')}
                      />
                      <Input
                        label="用户人数"
                        name="users_count"
                        defaultValue={extractValue(platformData, 'overall', 'users_count')}
                      />
                      <Input
                        label="评分链接"
                        name="url"
                        placeholder="如 https://www.metacritic.com/movie/xxxxxx"
                        defaultValue={extractValue(platformData, 'url')}
                      />
                    </div>
                  )}
                  {activePlatform === 'TMDB' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="评分"
                        name="rating"
                        type="number"
                        step="0.1"
                        defaultValue={extractValue(platformData, 'rating')}
                      />
                      <Input
                        label="投票数"
                        name="vote_count"
                        type="number"
                        defaultValue={extractValue(platformData, 'voteCount')}
                      />
                      <Input
                        label="评分链接"
                        name="url"
                        placeholder="如 https://www.themoviedb.org/movie/xxxxxx"
                        defaultValue={extractValue(platformData, 'url')}
                      />
                    </div>
                  )}
                  {activePlatform === 'Trakt' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="评分"
                        name="rating"
                        type="number"
                        step="0.1"
                        defaultValue={extractValue(platformData, 'rating')}
                      />
                      <Input
                        label="投票数"
                        name="votes"
                        type="number"
                        defaultValue={extractValue(platformData, 'votes')}
                      />
                      <Input
                        label="评分链接"
                        name="url"
                        placeholder="如 https://trakt.tv/movies/xxxxxx"
                        defaultValue={extractValue(platformData, 'url')}
                      />
                    </div>
                  )}
                  {selectedMedia.type === 'tv' && SEASON_PLATFORMS.includes(activePlatform) && (
                    <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-600">
                      <h3 className="font-medium text-gray-900 dark:text-white">分季评分</h3>
                      {displaySeasons.map((s, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">第 {s.season_number} 季</span>
                            <button
                              type="button"
                              onClick={() => setSeasons(displaySeasons.filter((_, i) => i !== idx))}
                              className="text-red-500 text-sm hover:text-red-600"
                            >
                              删除
                            </button>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {activePlatform === '豆瓣' && (
                              <>
                                <Input
                                  label="评分"
                                  value={String(s.rating ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(src.map((x, i) => (i === idx ? { ...x, rating: e.target.value } : x)));
                                  }}
                                  placeholder="8.5"
                                />
                                <Input
                                  label="评分人数"
                                  value={String(s.rating_people ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, rating_people: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="1000"
                                />
                                <Input
                                  label="评分链接"
                                  value={String(s.url ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(src.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)));
                                  }}
                                  placeholder="https://movie.douban.com/subject/xxx"
                                />
                              </>
                            )}
                            {activePlatform === 'Rotten Tomatoes' && (
                              <>
                                <Input
                                  label="番茄计"
                                  value={String(s.tomatometer ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, tomatometer: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="95"
                                />
                                <Input
                                  label="爆米花"
                                  value={String(s.audience_score ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, audience_score: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="88"
                                />
                                <Input
                                  label="平均新鲜度（专业均分）"
                                  value={String(s.critics_avg ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, critics_avg: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="7.8/10 或 3.9/5"
                                />
                                <Input
                                  label="平均评分（观众均分）"
                                  value={String(s.audience_avg ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, audience_avg: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="4.2/5"
                                />
                                <Input
                                  label="影评人数"
                                  value={String(s.critics_count ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, critics_count: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="200"
                                />
                                <Input
                                  label="观众人数"
                                  value={String(s.audience_count ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, audience_count: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="5000"
                                />
                                <Input
                                  label="评分链接"
                                  value={String(s.url ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(src.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)));
                                  }}
                                  placeholder="https://www.rottentomatoes.com/tv/xxxxxx/s01"
                                />
                              </>
                            )}
                            {activePlatform === 'Metacritic' && (
                              <>
                                <Input
                                  label="Metascore"
                                  value={String(s.metascore ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, metascore: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="85"
                                />
                                <Input
                                  label="User Score"
                                  value={String(s.userscore ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, userscore: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="8.5"
                                />
                                <Input
                                  label="影评人数"
                                  value={String(s.critics_count ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, critics_count: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="40"
                                />
                                <Input
                                  label="用户人数"
                                  value={String(s.users_count ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, users_count: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="500"
                                />
                                <Input
                                  label="评分链接"
                                  value={String(s.url ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(src.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)));
                                  }}
                                  placeholder="https://www.metacritic.com/tv/xxxxxx/season-1"
                                />
                              </>
                            )}
                            {activePlatform === 'TMDB' && (
                              <>
                                <Input
                                  label="评分"
                                  type="number"
                                  step="0.1"
                                  value={String(s.rating ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(src.map((x, i) => (i === idx ? { ...x, rating: e.target.value } : x)));
                                  }}
                                  placeholder="7.5"
                                />
                                <Input
                                  label="投票数"
                                  type="number"
                                  value={String(s.vote_count ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(
                                      src.map((x, i) => (i === idx ? { ...x, vote_count: e.target.value } : x))
                                    );
                                  }}
                                  placeholder="500"
                                />
                                <Input
                                  label="评分链接"
                                  value={String(s.url ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(src.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)));
                                  }}
                                  placeholder="https://www.themoviedb.org/tv/xxxxxx/season/1"
                                />
                              </>
                            )}
                            {activePlatform === 'Trakt' && (
                              <>
                                <Input
                                  label="评分"
                                  type="number"
                                  step="0.1"
                                  value={String(s.rating ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(src.map((x, i) => (i === idx ? { ...x, rating: e.target.value } : x)));
                                  }}
                                  placeholder="8.2"
                                />
                                <Input
                                  label="投票数"
                                  type="number"
                                  value={String(s.votes ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(src.map((x, i) => (i === idx ? { ...x, votes: e.target.value } : x)));
                                  }}
                                  placeholder="1000"
                                />
                                <Input
                                  label="评分链接"
                                  value={String(s.url ?? '')}
                                  onChange={(e) => {
                                    const src = seasons.length ? seasons : initialSeasons;
                                    setSeasons(src.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)));
                                  }}
                                  placeholder="https://trakt.tv/shows/xxxxxx/seasons/1"
                                />
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                      <button type="button" onClick={addSeason} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                        + 添加一季
                      </button>
                    </div>
                  )}
                  <Button type="submit" disabled={submitting}>
                    {submitting ? '提交中...' : '保存修改'}
                  </Button>
                </form>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
