// ==========================================
// 管理端评分录入页
// ==========================================
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '../../shared/hooks/useDebounce';
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
  'Rotten Tomatoes': 'rottentomatoes',
  'Metacritic': 'metacritic',
  'Letterboxd': 'letterboxd',
  'TMDB': 'tmdb',
  'Trakt': 'trakt',
};

interface SeasonEntry {
  season_number: number;
  [key: string]: string | number;
}

export default function AdminRatingInputPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'movie' | 'tv'>('movie');
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [activePlatform, setActivePlatform] = useState<string>(PLATFORMS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [seasons, setSeasons] = useState<SeasonEntry[]>([]);

  useEffect(() => {
    document.title = '评分手动录入（管理员） - RateFuse';
  }, []);

  const addSeason = () => {
    const next = seasons.length ? Math.max(...seasons.map((x) => Number(x.season_number) || 0)) + 1 : 1;
    setSeasons((p) => [...p, { season_number: next }]);
  };

  const debouncedQuery = useDebounce(searchQuery, 350);
  const { data: searchData } = useQuery({
    queryKey: ['admin-rating-search', debouncedQuery],
    queryFn: () => adminSearchMedia(debouncedQuery),
    enabled: !!debouncedQuery,
  });

  const movies = searchData?.movies?.results ?? [];
  const tvs = searchData?.tvShows?.results ?? [];
  const filteredItems = (searchType === 'movie' ? movies : tvs).slice(0, 12);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMedia) {
      toast.error('请先选择影视');
      return;
    }
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
          break;
        case 'imdb':
          payload.rating = formData.get('rating');
          payload.rating_people = formData.get('rating_people');
          break;
        case 'letterboxd':
          payload.rating = formData.get('rating');
          payload.rating_count = formData.get('rating_count');
          break;
        case 'rottentomatoes':
          payload.tomatometer = formData.get('tomatometer');
          payload.audience_score = formData.get('audience_score');
          payload.critics_avg = formData.get('critics_avg');
          payload.audience_avg = formData.get('audience_avg');
          payload.critics_count = formData.get('critics_count');
          payload.audience_count = formData.get('audience_count');
          break;
        case 'metacritic':
          payload.metascore = formData.get('metascore');
          payload.userscore = formData.get('userscore');
          payload.critics_count = formData.get('critics_count');
          payload.users_count = formData.get('users_count');
          break;
        case 'tmdb':
          payload.rating = formData.get('rating');
          payload.vote_count = formData.get('vote_count');
          break;
        case 'trakt':
          payload.rating = formData.get('rating');
          payload.votes = formData.get('votes');
          break;
      }
      if (selectedMedia.type === 'tv' && SEASON_PLATFORMS.includes(activePlatform) && seasons.length > 0) {
        payload.seasons = seasons.map((s) => {
          const base: Record<string, unknown> = { season_number: s.season_number };
          if (activePlatform === '豆瓣') {
            base.rating = s.rating ?? '';
            base.rating_people = s.rating_people ?? '';
          } else if (activePlatform === 'Rotten Tomatoes') {
            base.tomatometer = s.tomatometer ?? '';
            base.audience_score = s.audience_score ?? '';
            base.critics_avg = s.critics_avg ?? '';
            base.audience_avg = s.audience_avg ?? '';
            base.critics_count = s.critics_count ?? '';
            base.audience_count = s.audience_count ?? '';
          } else if (activePlatform === 'Metacritic') {
            base.metascore = s.metascore ?? '';
            base.userscore = s.userscore ?? '';
            base.critics_count = s.critics_count ?? '';
            base.users_count = s.users_count ?? '';
          } else if (activePlatform === 'TMDB') {
            base.rating = s.rating ?? '';
            base.vote_count = s.vote_count ?? '';
          } else if (activePlatform === 'Trakt') {
            base.rating = s.rating ?? '';
            base.votes = s.votes ?? '';
          }
          return base;
        });
      }

      const res = await fetch('/api/admin/ratings/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.detail || err?.message || `HTTP ${res.status}`;
        toast.error(`保存失败: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
        return;
      }
      toast.success('录入成功');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">
        评分手动录入
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        为影视添加各平台评分数据。剧集支持分季评分。请确保 Redis 已启动，否则无法持久化。
      </p>

      <div className="space-y-6">
        {/* 搜索选择影视 */}
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
            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-3">2. 选择平台并填写评分</h2>
              <CardTabs
                tabs={PLATFORMS.map((p) => ({ id: p, label: p }))}
                activeId={activePlatform}
                onChange={(id) => setActivePlatform(id)}
                className="mb-4"
              />
              <form onSubmit={handleSubmit} className="space-y-4">
                {activePlatform === '豆瓣' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="评分" name="rating" placeholder="如 8.5" />
                    <Input label="评分人数" name="rating_people" placeholder="如 100000" />
                    <Input label="评分链接" name="url" placeholder="如 https://movie.douban.com/subject/xxx" />
                  </div>
                )}
                {activePlatform === 'IMDb' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="评分" name="rating" placeholder="如 8.5" required />
                    <Input label="评分人数" name="rating_people" placeholder="如 1000000" />
                    <Input label="评分链接" name="url" placeholder="如 https://www.imdb.com/title/ttxxxxxxx/" />
                  </div>
                )}
                {activePlatform === 'Letterboxd' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="评分" name="rating" placeholder="如 3.8" required />
                    <Input label="评分人数" name="rating_count" placeholder="如 50000" />
                    <Input label="评分链接" name="url" placeholder="如 https://letterboxd.com/film/xxxxxx/" />
                  </div>
                )}
                {activePlatform === 'Rotten Tomatoes' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="番茄计" name="tomatometer" placeholder="如 95" />
                    <Input label="爆米花" name="audience_score" placeholder="如 88" />
                    <Input label="平均新鲜度（专业均分）" name="critics_avg" placeholder="如 7.8/10 或 3.9/5" />
                    <Input label="平均评分（观众均分）" name="audience_avg" placeholder="如 4.2/5" />
                    <Input label="影评人数" name="critics_count" placeholder="如 200" />
                    <Input label="观众人数" name="audience_count" placeholder="如 5000" />
                    <Input label="评分链接" name="url" placeholder="如 https://www.rottentomatoes.com/m/xxxxxx" />
                  </div>
                )}
                {activePlatform === 'Metacritic' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="Metascore" name="metascore" placeholder="如 85" />
                    <Input label="User Score" name="userscore" placeholder="如 8.5" />
                    <Input label="影评人数" name="critics_count" placeholder="如 40" />
                    <Input label="用户人数" name="users_count" placeholder="如 500" />
                    <Input label="评分链接" name="url" placeholder="如 https://www.metacritic.com/movie/xxxxxx" />
                  </div>
                )}
                {activePlatform === 'TMDB' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="评分" name="rating" placeholder="如 7.8" type="number" step="0.1" required />
                    <Input label="投票数" name="vote_count" placeholder="如 5000" type="number" />
                    <Input label="评分链接" name="url" placeholder="如 https://www.themoviedb.org/movie/xxxxxx" />
                  </div>
                )}
                {activePlatform === 'Trakt' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="评分" name="rating" placeholder="如 8.2" type="number" step="0.1" required />
                    <Input label="投票数" name="votes" placeholder="如 10000" type="number" />
                    <Input label="评分链接" name="url" placeholder="如 https://trakt.tv/movies/xxxxxx" />
                  </div>
                )}
                {selectedMedia.type === 'tv' && SEASON_PLATFORMS.includes(activePlatform) && (
                  <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-600">
                    <h3 className="font-medium text-gray-900 dark:text-white">分季评分（可选）</h3>
                    {seasons.map((s, idx) => (
                      <div key={idx} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">第 {s.season_number} 季</span>
                          <button
                            type="button"
                            onClick={() => setSeasons((prev) => prev.filter((_, i) => i !== idx))}
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
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, rating: e.target.value } : x))
                                  )
                                }
                                placeholder="8.5"
                              />
                              <Input
                                label="评分人数"
                                value={String(s.rating_people ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, rating_people: e.target.value } : x))
                                  )
                                }
                                placeholder="1000"
                              />
                              <Input
                                label="评分链接"
                                value={String(s.url ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x))
                                  )
                                }
                                placeholder="https://movie.douban.com/subject/xxx"
                              />
                            </>
                          )}
                          {activePlatform === 'Rotten Tomatoes' && (
                            <>
                              <Input
                                label="番茄计"
                                value={String(s.tomatometer ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, tomatometer: e.target.value } : x))
                                  )
                                }
                                placeholder="95"
                              />
                              <Input
                                label="爆米花"
                                value={String(s.audience_score ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, audience_score: e.target.value } : x))
                                  )
                                }
                                placeholder="88"
                              />
                          <Input
                            label="平均新鲜度（专业均分）"
                            value={String(s.critics_avg ?? '')}
                            onChange={(e) =>
                              setSeasons((p) =>
                                p.map((x, i) => (i === idx ? { ...x, critics_avg: e.target.value } : x))
                              )
                            }
                            placeholder="7.8/10 或 3.9/5"
                          />
                          <Input
                            label="平均评分（观众均分）"
                            value={String(s.audience_avg ?? '')}
                            onChange={(e) =>
                              setSeasons((p) =>
                                p.map((x, i) => (i === idx ? { ...x, audience_avg: e.target.value } : x))
                              )
                            }
                            placeholder="4.2/5"
                          />
                              <Input
                                label="影评人数"
                                value={String(s.critics_count ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, critics_count: e.target.value } : x))
                                  )
                                }
                                placeholder="200"
                              />
                              <Input
                                label="观众人数"
                                value={String(s.audience_count ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, audience_count: e.target.value } : x))
                                  )
                                }
                                placeholder="5000"
                              />
                              <Input
                                label="评分链接"
                                value={String(s.url ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x))
                                  )
                                }
                                placeholder="https://www.rottentomatoes.com/tv/xxxxxx/s01"
                              />
                            </>
                          )}
                          {activePlatform === 'Metacritic' && (
                            <>
                              <Input
                                label="Metascore"
                                value={String(s.metascore ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, metascore: e.target.value } : x))
                                  )
                                }
                                placeholder="85"
                              />
                              <Input
                                label="User Score"
                                value={String(s.userscore ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, userscore: e.target.value } : x))
                                  )
                                }
                                placeholder="8.5"
                              />
                              <Input
                                label="影评人数"
                                value={String(s.critics_count ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, critics_count: e.target.value } : x))
                                  )
                                }
                                placeholder="40"
                              />
                              <Input
                                label="用户人数"
                                value={String(s.users_count ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, users_count: e.target.value } : x))
                                  )
                                }
                                placeholder="500"
                              />
                              <Input
                                label="评分链接"
                                value={String(s.url ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x))
                                  )
                                }
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
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, rating: e.target.value } : x))
                                  )
                                }
                                placeholder="7.5"
                              />
                              <Input
                                label="投票数"
                                type="number"
                                value={String(s.vote_count ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, vote_count: e.target.value } : x))
                                  )
                                }
                                placeholder="500"
                              />
                              <Input
                                label="评分链接"
                                value={String(s.url ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x))
                                  )
                                }
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
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, rating: e.target.value } : x))
                                  )
                                }
                                placeholder="8.2"
                              />
                              <Input
                                label="投票数"
                                type="number"
                                value={String(s.votes ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, votes: e.target.value } : x))
                                  )
                                }
                                placeholder="1000"
                              />
                              <Input
                                label="评分链接"
                                value={String(s.url ?? '')}
                                onChange={(e) =>
                                  setSeasons((p) =>
                                    p.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x))
                                  )
                                }
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
                  {submitting ? '提交中...' : '提交录入'}
                </Button>
              </form>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
