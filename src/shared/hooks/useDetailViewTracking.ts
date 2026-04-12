// ==========================================
// 详情页访问记录 Hook
// ==========================================
import { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { authFetch } from '../../api/authFetch';
import type { FetchStatus } from '../types/status';

type DetailViewPlatformStatuses = Record<string, { status: FetchStatus }>;

const TRACK_PLATFORMS = [
  'douban',
  'imdb',
  'letterboxd',
  'rottentomatoes',
  'metacritic',
] as const;

function buildStatusPayload(
  platformStatuses: DetailViewPlatformStatuses,
  tmdbStatus: FetchStatus,
  traktStatus: FetchStatus
) {
  const pick = (k: (typeof TRACK_PLATFORMS)[number]) =>
    platformStatuses[k]?.status ?? ('pending' as FetchStatus);
  return {
    douban: pick('douban'),
    imdb: pick('imdb'),
    letterboxd: pick('letterboxd'),
    rottentomatoes: pick('rottentomatoes'),
    metacritic: pick('metacritic'),
    tmdb: tmdbStatus,
    trakt: traktStatus,
  };
}

type Snapshot = {
  logId: number;
  forMediaId: string;
  platform_rating_fetch_statuses: ReturnType<typeof buildStatusPayload>;
};

function patchDetailViewStatuses(logId: number, statuses: ReturnType<typeof buildStatusPayload>) {
  void authFetch(`/api/track/detail-view/${logId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform_rating_fetch_statuses: statuses }),
    withAuth: true,
    keepalive: true,
  });
}

export function useDetailViewTracking(opts: {
  mediaType: 'movie' | 'tv';
  mediaId: string | undefined;
  mediaLoaded: boolean;
  title: string | undefined;
  platformStatuses: DetailViewPlatformStatuses;
  tmdbStatus: FetchStatus;
  traktStatus: FetchStatus;
}) {
  const { mediaType, mediaId, mediaLoaded, title, platformStatuses, tmdbStatus, traktStatus } =
    opts;

  const [detailViewLogId, setDetailViewLogId] = useState<number | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const prevMediaIdRef = useRef<string | undefined>(undefined);
  const postedKeyRef = useRef<string | null>(null);
  const committedMediaKeyRef = useRef<string | null>(null);

  const mediaKey = mediaId ? `${mediaType}:${mediaId}` : null;

  if (
    detailViewLogId != null &&
    mediaId &&
    mediaKey &&
    committedMediaKeyRef.current === mediaKey
  ) {
    snapshotRef.current = {
      logId: detailViewLogId,
      forMediaId: mediaId,
      platform_rating_fetch_statuses: buildStatusPayload(
        platformStatuses,
        tmdbStatus,
        traktStatus
      ),
    };
  }

  useLayoutEffect(() => {
    if (prevMediaIdRef.current !== undefined && prevMediaIdRef.current !== mediaId) {
      const snap = snapshotRef.current;
      const prevId = prevMediaIdRef.current;
      if (snap && snap.forMediaId === prevId && snap.logId) {
        patchDetailViewStatuses(snap.logId, snap.platform_rating_fetch_statuses);
      }
      snapshotRef.current = null;
      setDetailViewLogId(null);
      committedMediaKeyRef.current = null;
      postedKeyRef.current = null;
    }
    prevMediaIdRef.current = mediaId;
  }, [mediaId]);

  useEffect(() => {
    if (!mediaId || !mediaLoaded) return;
    const t = String(title || '').trim();
    if (!t) return;
    const key = `${mediaType}:${mediaId}`;
    if (postedKeyRef.current === key) return;

    postedKeyRef.current = key;

    const url = `${window.location.origin}${window.location.pathname}`;
    const n = Number(mediaId);
    const tmdbNum = Number.isFinite(n) ? n : undefined;

    void authFetch('/api/track/detail-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: mediaType,
        tmdb_id: tmdbNum,
        title: t,
        url,
      }),
      withAuth: true,
      keepalive: true,
    })
      .then(async (res) => {
        if (!res.ok) {
          postedKeyRef.current = null;
          return;
        }
        let data: { id?: number } = {};
        try {
          data = await res.json();
        } catch {
          postedKeyRef.current = null;
          return;
        }
        if (postedKeyRef.current !== key) return;
        if (typeof data.id !== 'number') {
          postedKeyRef.current = null;
          return;
        }
        committedMediaKeyRef.current = key;
        setDetailViewLogId(data.id);
      })
      .catch(() => {
        postedKeyRef.current = null;
      });
  }, [mediaType, mediaId, mediaLoaded, title]);

  useEffect(() => {
    const flush = () => {
      const snap = snapshotRef.current;
      if (!snap?.logId) return;
      patchDetailViewStatuses(snap.logId, snap.platform_rating_fetch_statuses);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);
}
