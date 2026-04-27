// ==========================================
// 媒体评分数据 Hook
// ==========================================
import { useState, useEffect, useRef } from 'react';
import { fetchTMDBRating, fetchTraktRating } from '../../api/ratings';
import type { FetchStatus } from '../../shared/types/status';
import type { TMDBRating, TraktRating } from '../../modules/rating/ratings';

interface PlatformStatus {
  status: FetchStatus;
  data: any;
}

interface PlatformStatuses {
  [key: string]: PlatformStatus;
}

interface UseMediaRatingsOptions {
  mediaId: string | undefined;
  mediaType: 'movie' | 'tv';
}

interface UseMediaRatingsReturn {
  platformStatuses: PlatformStatuses;
  tmdbStatus: FetchStatus;
  traktStatus: FetchStatus;
  tmdbRating: TMDBRating | null;
  traktRating: TraktRating | null;
  retryCount: Record<string, number>;
  handleRetry: (platform: string) => Promise<void>;
  doubanLimitDialogOpen: boolean;
  doubanLimitDialogMessage: string;
  closeDoubanLimitDialog: () => void;
}

const BACKEND_PLATFORMS = ['douban', 'imdb', 'letterboxd', 'rottentomatoes', 'metacritic'] as const;

const BACKEND_PLATFORM_FETCH_TIMEOUT_MS = 120_000;

function mapBackendStatusToFrontend(data: { status?: string; status_reason?: string } | null): FetchStatus {
  if (!data || typeof data !== 'object') return 'error';
  const status = String(data.status ?? '').trim();
  const reason = String(data.status_reason ?? '').trim();
  if (reason.includes('未收录')) return 'not_found';
  if (reason.includes('平台已锁定') || reason.includes('停止抓取')) return 'not_found';
  if (status.toLowerCase() === 'no found') return 'not_found';
  if (status.toLowerCase() === 'locked') return 'not_found';
  switch (status) {
    case 'Successful':
      return 'successful';
    case 'No Found':
      return 'not_found';
    case 'No Rating':
      return 'no_rating';
    case 'RateLimit':
      return 'rate_limit';
    case 'Timeout':
      return 'timeout';
    case 'Fail':
      return 'fail';
    case 'Locked':
      return 'not_found';
    default:
      return 'error';
  }
}

function createTraktDistribution(data: any) {
  return {
    '1': Number(data.distribution?.['1'] || 0),
    '2': Number(data.distribution?.['2'] || 0),
    '3': Number(data.distribution?.['3'] || 0),
    '4': Number(data.distribution?.['4'] || 0),
    '5': Number(data.distribution?.['5'] || 0),
    '6': Number(data.distribution?.['6'] || 0),
    '7': Number(data.distribution?.['7'] || 0),
    '8': Number(data.distribution?.['8'] || 0),
    '9': Number(data.distribution?.['9'] || 0),
    '10': Number(data.distribution?.['10'] || 0)
  };
}

export function useMediaRatings({ mediaId, mediaType }: UseMediaRatingsOptions): UseMediaRatingsReturn {
  const [platformStatuses, setPlatformStatuses] = useState<PlatformStatuses>({
    douban: { status: 'pending', data: null },
    imdb: { status: 'pending', data: null },
    letterboxd: { status: 'pending', data: null },
    rottentomatoes: { status: 'pending', data: null },
    metacritic: { status: 'pending', data: null }
  });
  
  const [tmdbStatus, setTmdbStatus] = useState<FetchStatus>('pending');
  const [traktStatus, setTraktStatus] = useState<FetchStatus>('pending');
  const [tmdbRating, setTmdbRating] = useState<TMDBRating | null>(null);
  const [traktRating, setTraktRating] = useState<TraktRating | null>(null);
  const [retryCount, setRetryCount] = useState<Record<string, number>>({});
  const [doubanLimitDialogOpen, setDoubanLimitDialogOpen] = useState(false);
  const [doubanLimitDialogMessage, setDoubanLimitDialogMessage] = useState('');
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastPopupRef = useRef<Record<string, string>>({});
  
  const closeDoubanLimitDialog = () => setDoubanLimitDialogOpen(false);

  useEffect(() => {
    if (!mediaId) return;

    const fetchAllRatings = async () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      BACKEND_PLATFORMS.forEach(platform => {
        setPlatformStatuses(prev => ({
          ...prev,
          [platform]: { ...prev[platform], status: 'loading' }
        }));
      });
      setTmdbStatus('loading');
      setTraktStatus('loading');

      try {
        const token = localStorage.getItem('token');
        const apiType = mediaType === 'movie' ? 'movie' : 'tv';
        const traktType = mediaType === 'movie' ? 'movies' : 'shows';

        const backendPromises = BACKEND_PLATFORMS.map(async platform => {
          const platformAbort = new AbortController();
          const timeoutId = setTimeout(() => platformAbort.abort(), BACKEND_PLATFORM_FETCH_TIMEOUT_MS);
          try {
            const response = await fetch(`/api/ratings/${platform}/${apiType}/${mediaId}`, {
              signal: platformAbort.signal,
              cache: 'no-store',
              ...(token && { headers: { 'Authorization': `Bearer ${token}` } })
            });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error('获取评分失败');
            const data = await response.json();

            setPlatformStatuses(prev => ({
              ...prev,
              [platform]: {
                status: mapBackendStatusToFrontend(data),
                data
              }
            }));
            try {
              if (String(data?.status || '') === 'RateLimit') {
                const message = String(data?.popup_message || data?.status_reason || '').trim();
                if (message && lastPopupRef.current[platform] !== message) {
                  lastPopupRef.current[platform] = message;
                  if (platform === 'douban') {
                    setDoubanLimitDialogMessage(message);
                    setDoubanLimitDialogOpen(true);
                  }
                }
              }
            } catch {
            }

            return { platform, status: 'successful', data };
          } catch (error) {
            clearTimeout(timeoutId);
            setPlatformStatuses(prev => ({
              ...prev,
              [platform]: { status: 'error', data: null }
            }));
            return { platform, status: 'error', data: null };
          }
        });

        const tmdbPromise = fetchTMDBRating(apiType, mediaId)
          .then(data => {
            if (!data || !data.rating) {
              setTmdbStatus('no_rating');
              setTmdbRating(null);
              return;
            }
            
            const tmdbData: TMDBRating = {
              rating: Number(data.rating),
              voteCount: Number(data.voteCount),
              ...(mediaType === 'tv' && data.seasons ? {
                seasons: data.seasons.map((s: any) => ({
                  season_number: Number(s.season_number),
                  rating: Number(s.rating),
                  voteCount: Number(s.voteCount)
                }))
              } : {})
            };
            
            setTmdbRating(tmdbData);
            setTmdbStatus('successful');
          })
          .catch(() => {
            setTmdbStatus('error');
            setTmdbRating(null);
          });

        const traktPromise = fetchTraktRating(traktType, mediaId)
          .then((data: any) => {
            if (!data || !data.rating) {
              setTraktStatus('no_rating');
              setTraktRating(null);
              return;
            }

            const traktData: TraktRating = {
              rating: Number(data.rating),
              votes: Number(data.votes || 0),
              distribution: createTraktDistribution(data),
              ...(mediaType === 'tv' && data.seasons ? {
                seasons: data.seasons.map((season: any) => ({
                  season_number: Number(season.season_number),
                  rating: Number(season.rating),
                  votes: Number(season.votes || season.voteCount || 0),
                  distribution: season.distribution
                }))
              } : {})
            };

            setTraktRating(traktData);
            setTraktStatus('successful');
          })
          .catch(() => {
            setTraktStatus('error');
            setTraktRating(null);
          });

        await Promise.all([...backendPromises, tmdbPromise, traktPromise]);
      } catch (err: unknown) {
        const error = err as Error;
        if (error.name !== 'AbortError') {
          console.error('获取评分失败:', error);
        }
      }
    };

    fetchAllRatings();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [mediaId, mediaType]);

  const handleRetry = async (platform: string) => {
    if (!mediaId) return;

    setRetryCount(prev => ({
      ...prev,
      [platform]: (prev[platform] || 0) + 1
    }));

    const apiType = mediaType === 'movie' ? 'movie' : 'tv';
    const traktType = mediaType === 'movie' ? 'movies' : 'shows';

    if (platform === 'tmdb') {
      setTmdbStatus('loading');
      try {
        const data = await fetchTMDBRating(apiType, mediaId);
        if (!data || !data.rating) {
          setTmdbStatus('no_rating');
          setTmdbRating(null);
          return;
        }
        
        const tmdbData: TMDBRating = {
          rating: Number(data.rating),
          voteCount: Number(data.voteCount),
          ...(mediaType === 'tv' && data.seasons ? {
            seasons: data.seasons.map((s: any) => ({
              season_number: Number(s.season_number),
              rating: Number(s.rating),
              voteCount: Number(s.voteCount)
            }))
          } : {})
        };
        
        setTmdbRating(tmdbData);
        setTmdbStatus('successful');
      } catch (error) {
        setTmdbStatus('error');
        setTmdbRating(null);
      }
    } else if (platform === 'trakt') {
      setTraktStatus('loading');
      try {
        const data = await fetchTraktRating(traktType, mediaId);
        if (!data || !data.rating) {
          setTraktStatus('no_rating');
          setTraktRating(null);
          return;
        }

        const traktData: TraktRating = {
          rating: Number(data.rating),
          votes: Number(data.votes || 0),
          distribution: createTraktDistribution(data),
          ...(mediaType === 'tv' && data.seasons ? {
            seasons: data.seasons.map((season: any) => ({
              season_number: Number(season.season_number),
              rating: Number(season.rating),
              votes: Number(season.votes || season.voteCount || 0),
              distribution: season.distribution
            }))
          } : {})
        };

        setTraktRating(traktData);
        setTraktStatus('successful');
      } catch (error) {
        setTraktStatus('error');
        setTraktRating(null);
      }
    } else {
      setPlatformStatuses(prev => ({
        ...prev,
        [platform]: { ...prev[platform], status: 'loading' }
      }));

      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/ratings/${platform}/${apiType}/${mediaId}`, {
          ...(token && { headers: { 'Authorization': `Bearer ${token}` } })
        });
        if (!response.ok) throw new Error('获取评分失败');
        const data = await response.json();

        const frontendStatus = mapBackendStatusToFrontend(data);

        setPlatformStatuses(prev => ({
          ...prev,
          [platform]: { status: frontendStatus, data }
        }));
        try {
          if (String(data?.status || '') === 'RateLimit') {
            const message = String(data?.popup_message || data?.status_reason || '').trim();
            if (message && lastPopupRef.current[platform] !== message) {
              lastPopupRef.current[platform] = message;
              if (platform === 'douban') {
                setDoubanLimitDialogMessage(message);
                setDoubanLimitDialogOpen(true);
              }
            }
          }
        } catch {
        }
      } catch (error) {
        setPlatformStatuses(prev => ({
          ...prev,
          [platform]: { status: 'error', data: null }
        }));
      }
    }
  };

  return {
    platformStatuses,
    tmdbStatus,
    traktStatus,
    tmdbRating,
    traktRating,
    retryCount,
    handleRetry,
    doubanLimitDialogOpen,
    doubanLimitDialogMessage,
    closeDoubanLimitDialog,
  };
}
