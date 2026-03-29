// ==========================================
// 首页
// ==========================================
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import type { TouchEvent, CSSProperties } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { SearchResults } from '../modules/search/SearchResults';
import { Pagination } from '../shared/ui/Pagination';
import { searchMedia } from '../api/index';
import { searchUsers, type UserSearchItem } from '../api/users';
import { messages } from '../shared/utils/messages';
import { ThemeToggle } from '../shared/ui/ThemeToggle';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { MiniFavoriteButton } from '../modules/favorite/MiniFavoriteButton';
import { usePageMeta } from '../shared/hooks/usePageMeta';
import { NavBar } from '../shared/ui/NavBar';
import { Footer } from '../shared/ui/Footer';
import { useAuth } from '../modules/auth/AuthContext';
import { authFetch } from '../api/authFetch';
import { toast } from 'sonner';
import { ConfirmDialog } from '../shared/ui/ConfirmDialog';
import { toSiteTmdbImageUrl } from '../api/image';
import { buildTmdbApiUrl, TMDB } from '../api/api';

const DOWNSCALE_SIZE = 'w500';
const HERO_IMAGE_SIZE = 'original';
const HERO_BG_SIZE = 'w780';
const HERO_POOL_SIZE = 30;
const SEGMENT_SIZE = 10;
const HERO_INTERVAL_MS = 5000
const NO_LANG = 'null';

type TopItem = { id: number; type: 'movie' | 'tv'; title: string; poster: string };
type HeroDetail = {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  genres: string[];
  logoUrl: string;
  imageUrl: string;
  poster: string;
};

type AggregateCharts = {
  top_movies?: Array<{ id: number; type: 'movie' | 'tv'; title: string; poster: string }>;
  top_tv?: Array<{ id: number; type: 'movie' | 'tv'; title: string; poster: string }>;
  top_chinese_tv?: Array<{ id: number; type: 'movie' | 'tv'; title: string; poster: string }>;
};

type ChartEntry = { id: number; type: 'movie' | 'tv'; title: string; poster: string };

const downscaleTmdb = (url: string, size = DOWNSCALE_SIZE) => {
  const tmdbPattern = /https?:\/\/image\.tmdb\.org\/t\/p\/(original|w\d+)(\/.+)/;
  const match = url.match(tmdbPattern);
  if (match) return `${TMDB.imageOrigin}/t/p/${size}${match[2]}`;
  if (url.startsWith('/tmdb-images/')) {
    const path = url.replace(/^\/tmdb-images\/(?:original|w\d+)/, '');
    return `${TMDB.imageOrigin}/t/p/${size}${path}`;
  }
  if (url.startsWith('/tmdb/')) {
    const path = url.replace(/^\/tmdb\/(?:original|w\d+)/, '');
    return `${TMDB.imageOrigin}/t/p/${size}${path}`;
  }
  return url;
};

const resolvePosterUrl = (poster: string, size = DOWNSCALE_SIZE) => {
  if (!poster) return '';
  return toSiteTmdbImageUrl(downscaleTmdb(poster, size));
};

const resolveHeroImageUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('/tmdb-images/') || url.startsWith('http://') || url.startsWith('https://')) {
    return toSiteTmdbImageUrl(url);
  }
  return resolvePosterUrl(url, HERO_IMAGE_SIZE);
};

const toTmdbImagePath = (path: string | null | undefined, size = 'original') => {
  if (!path) return '';
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${TMDB.imageOrigin}/t/p/${size}${p}`;
};

const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);

function pickLogo(logos: Array<{ file_path?: string; iso_639_1?: string | null }> = []) {
  const preferred =
    logos.find((x) => x.iso_639_1 === 'zh') ||
    logos.find((x) => x.iso_639_1 === 'cn') ||
    logos.find((x) => x.iso_639_1 === null) ||
    logos.find((x) => x.iso_639_1 === 'en') ||
    logos[0];
  return toTmdbImagePath(preferred?.file_path, HERO_IMAGE_SIZE);
}

function pickHeroPosterImage(
  images: {
    posters?: Array<{ file_path?: string; iso_639_1?: string | null }>;
  } = {},
  fallbackPoster: string
) {
  const noLangPoster = images.posters?.find((p) => p.iso_639_1 === null);
  const anyPoster = images.posters?.[0];
  return (
    toTmdbImagePath(noLangPoster?.file_path, HERO_IMAGE_SIZE) ||
    toTmdbImagePath(anyPoster?.file_path, HERO_IMAGE_SIZE) ||
    resolvePosterUrl(fallbackPoster, HERO_IMAGE_SIZE)
  );
}

const HERO_TITLE_SHADOW: CSSProperties = {
  textShadow: '0 2px 12px rgba(0,0,0,0.95), 0 1px 4px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,1)',
};

const homeTopPanelClass =
  'overflow-hidden rounded-2xl transition-all duration-200 home-top-panel';

function TopChartCard({
  item,
  eager,
  compact,
}: {
  item: ChartEntry;
  eager?: boolean;
  compact?: boolean;
}) {
  const linkPath = item.type === 'movie' ? `/movie/${item.id}` : `/tv/${item.id}`;
  return (
    <div
      data-top-card
      className={`group relative snap-start ${
        compact
          ? 'w-full min-w-0'
          : 'w-[clamp(72px,20vw,104px)] shrink-0 sm:w-[clamp(80px,18vw,112px)]'
      }`}
    >
      <Link to={linkPath} target="_blank" rel="noopener noreferrer" className="block">
        <div
          className={`relative overflow-hidden rounded-lg bg-gray-200 transition-all duration-200 group-hover:shadow-lg dark:bg-gray-800 ${
            compact ? 'aspect-[2/3] w-full' : 'aspect-[2/3]'
          }`}
          style={{ transform: 'translateZ(0)' }}
        >
          {item.poster ? (
            <img
              src={resolvePosterUrl(item.poster)}
              alt={item.title}
              className="h-full w-full object-cover transition-all duration-200 group-hover:scale-105"
              loading={eager ? 'eager' : 'lazy'}
              fetchPriority={eager ? 'high' : 'auto'}
              decoding="async"
              sizes={compact ? '(min-width:1024px) 10vw, 28vw' : '(min-width:640px) 18vw, 22vw'}
              style={{
                minHeight: '100%',
                display: 'block',
                opacity: 0,
                transition: 'opacity 0.2s ease-in',
              }}
              onLoad={(e) => {
                const target = e.target as HTMLImageElement;
                if (target && target.complete && target.naturalWidth > 0) {
                  requestAnimationFrame(() => {
                    target.style.opacity = '1';
                  });
                }
              }}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                if (target) target.style.opacity = '0';
              }}
              crossOrigin="anonymous"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gray-200 dark:bg-gray-800">
              <div className="text-xs text-gray-400 dark:text-gray-600">无海报</div>
            </div>
          )}
        </div>
        <div
          className={`mt-1 line-clamp-2 text-center font-medium text-gray-800 dark:text-gray-100 ${
            compact ? 'text-[10px] leading-tight sm:text-xs' : 'text-xs sm:text-sm'
          }`}
        >
          {item.title}
        </div>
      </Link>
      <div className="absolute top-1 right-1 z-20">
        <MiniFavoriteButton
          mediaId={item.id.toString()}
          mediaType={item.type}
          title={item.title}
          poster={item.poster}
          className="p-1"
        />
      </div>
    </div>
  );
}

function splitTop10ListTitle(title: string): { badge: string; subtitle: string } | null {
  const m = title.trim().match(/^本周\s*Top10\s*(.+)$/i);
  if (!m) return null;
  const rest = m[1].trim();
  if (!rest) return null;
  return { badge: 'TOP 10', subtitle: `本周 ${rest}` };
}

function Top10DesktopTitle({ title }: { title: string }) {
  const parsed = splitTop10ListTitle(title);
  if (!parsed) {
    return (
      <h2 className="text-right text-[10px] font-bold leading-snug text-gray-900 dark:text-gray-100 sm:text-xs">
        {title}
      </h2>
    );
  }
  return (
    <h2
      className="flex min-w-0 flex-col items-end justify-center gap-0.5 text-right"
      aria-label={title}
    >
      <span className="block select-none font-extrabold italic leading-none tracking-[0.12em] text-[clamp(0.9375rem,0.58rem+1.35vw,1.45rem)] text-gray-950 [text-shadow:0_1px_0_rgba(255,255,255,0.45)] dark:text-gray-50 dark:[text-shadow:0_1px_2px_rgba(0,0,0,0.55)] sm:tracking-[0.14em]">
        {parsed.badge}
      </span>
      <span className="max-w-full break-words font-medium leading-snug text-[clamp(0.5rem,0.38rem+0.7vw,0.8125rem)] text-gray-800 dark:text-gray-200/95">
        {parsed.subtitle}
      </span>
    </h2>
  );
}

function TopHorizontalSection({
  title,
  items,
  isLoading,
  variant,
}: {
  title: string;
  items?: ChartEntry[];
  isLoading: boolean;
  variant: 'desktop' | 'mobile';
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const isMobileVariant = variant === 'mobile';
  const isCoarsePointer =
    typeof window !== 'undefined'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;

  const updateScrollArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (variant === 'mobile' && isCoarsePointer) {
      setShowLeft(false);
      setShowRight(false);
      return;
    }
    const scrollWidth = el.scrollWidth;
    const clientWidth = el.clientWidth;
    const sl = Math.max(0, el.scrollLeft);
    const maxScroll = Math.max(0, scrollWidth - clientWidth);
    const hasOverflow = scrollWidth > clientWidth + 1;
    if (!hasOverflow) {
      setShowLeft(false);
      setShowRight(false);
      return;
    }
    setShowLeft(sl > 10);
    setShowRight(sl < maxScroll - 10);
  }, [variant, isCoarsePointer]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !items?.length) return;
    updateScrollArrows();
    el.addEventListener('scroll', updateScrollArrows, { passive: true });
    const ro = new ResizeObserver(updateScrollArrows);
    ro.observe(el);
    const first = el.firstElementChild as HTMLElement | null;
    const last = el.lastElementChild as HTMLElement | null;
    if (first) ro.observe(first);
    if (last && last !== first) ro.observe(last);
    const t = window.requestAnimationFrame(updateScrollArrows);
    return () => {
      window.cancelAnimationFrame(t);
      el.removeEventListener('scroll', updateScrollArrows);
      ro.disconnect();
    };
  }, [items, updateScrollArrows]);

  const scrollByDir = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const card = el.querySelector('[data-top-card]') as HTMLElement | null;
    const step = (card?.offsetWidth ?? 80) + 8;
    el.scrollBy({ left: dir * step * 3, behavior: 'smooth' });
    window.requestAnimationFrame(() => updateScrollArrows());
  };

  const desktop = variant === 'desktop';
  const stopTopListEvent = (e: { stopPropagation: () => void }) => {
    if (!isMobileVariant || !isCoarsePointer) return;
    e.stopPropagation();
  };

  if (!items || isLoading) {
    return (
      <div
        className={`${homeTopPanelClass} flex flex-col p-3 sm:p-4 ${
          desktop ? 'min-h-0 flex-1 flex-row gap-2' : ''
        }`}
      >
        {desktop ? (
          <>
            <div className="flex min-w-0 w-[4.75rem] shrink-0 flex-col justify-center sm:w-[5.5rem]">
              <Top10DesktopTitle title={title} />
            </div>
            <div className="flex min-h-[72px] flex-1 items-center justify-center text-xs text-gray-600 dark:text-gray-400">
              加载中...
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-4 text-center text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
              {title}
            </h2>
            <div className="flex items-center justify-center py-8 text-gray-600 dark:text-gray-400">
              加载中...
            </div>
          </>
        )}
      </div>
    );
  }

  const strip = (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {showLeft ? (
        <button
          type="button"
          aria-label="向左"
          onClick={(e) => {
            stopTopListEvent(e);
            scrollByDir(-1);
          }}
          onTouchStart={stopTopListEvent}
          onPointerDown={stopTopListEvent}
          className="absolute inset-y-0 left-0 z-30 flex w-10 items-center justify-center rounded-2xl bg-white/40 dark:bg-white/40"
        >
          <ChevronLeft className="h-5 w-5 text-gray-800 dark:text-gray-100" />
        </button>
      ) : null}
      {showRight ? (
        <button
          type="button"
          aria-label="向右"
          onClick={(e) => {
            stopTopListEvent(e);
            scrollByDir(1);
          }}
          onTouchStart={stopTopListEvent}
          onPointerDown={stopTopListEvent}
          className="absolute inset-y-0 right-0 z-30 flex w-10 items-center justify-center rounded-2xl bg-white/40 dark:bg-white/40"
        >
          <ChevronRight className="h-5 w-5 text-gray-800 dark:text-gray-100" />
        </button>
      ) : null}
      <div className={desktop ? 'flex min-h-0 flex-1 flex-col justify-center' : 'contents'}>
        <div
          ref={scrollRef}
          className={`scrollbar-hide overflow-y-hidden pl-2 pr-8 py-0.5 ${
            desktop
              ? 'grid w-full grid-cols-10 items-start gap-2 overflow-x-hidden'
              : 'flex min-h-0 min-w-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain min-h-[148px] gap-2'
          }`}
          onTouchStart={stopTopListEvent}
          onTouchMove={stopTopListEvent}
          onTouchEnd={stopTopListEvent}
        >
          {items.map((item, idx) => (
            <div key={`${item.type}-${item.id}`} className={desktop ? 'min-w-0' : 'shrink-0'}>
              <TopChartCard item={item} eager={!desktop || idx === 0} compact={desktop} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (desktop) {
    return (
      <div className={`${homeTopPanelClass} flex min-h-0 flex-1 flex-row gap-2 p-2 sm:p-3`}>
        <div className="flex min-w-0 w-[4.75rem] shrink-0 flex-col justify-center sm:w-[5.5rem]">
          <Top10DesktopTitle title={title} />
        </div>
        {strip}
      </div>
    );
  }

  return (
    <div className={`${homeTopPanelClass} flex flex-col p-4 sm:p-5`}>
      <h2 className="mb-4 text-center text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
        {title}
      </h2>
      {strip}
    </div>
  );
}

function TopSectionsPanel({
  chartData,
  isLoading,
  variant,
}: {
  chartData?: AggregateCharts;
  isLoading: boolean;
  variant: 'desktop' | 'mobile';
}) {
  if (variant === 'desktop') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-visible">
        <TopHorizontalSection
          title="本周Top10 热门电影"
          items={chartData?.top_movies}
          isLoading={isLoading}
          variant="desktop"
        />
        <TopHorizontalSection
          title="本周Top10 热门剧集"
          items={chartData?.top_tv}
          isLoading={isLoading}
          variant="desktop"
        />
        <TopHorizontalSection
          title="本周Top10 华语剧集"
          items={chartData?.top_chinese_tv}
          isLoading={isLoading}
          variant="desktop"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TopHorizontalSection
        title="本周Top10 热门电影"
        items={chartData?.top_movies}
        isLoading={isLoading}
        variant="mobile"
      />
      <TopHorizontalSection
        title="本周Top10 热门剧集"
        items={chartData?.top_tv}
        isLoading={isLoading}
        variant="mobile"
      />
      <TopHorizontalSection
        title="本周Top10 华语剧集"
        items={chartData?.top_chinese_tv}
        isLoading={isLoading}
        variant="mobile"
      />
    </div>
  );
}

function HeroCarousel({
  items,
  chartData,
  chartsLoading,
}: {
  items: TopItem[];
  chartData?: AggregateCharts;
  chartsLoading: boolean;
}) {
  const [, setHeroLoadedVersion] = useState(0);
  const heroPosterByKeyRef = useRef<Record<string, string>>({});
  const heroLogoByKeyRef = useRef<Record<string, string>>({});
  const advanceSeqRef = useRef(0);
  const prefetchSeqRef = useRef(0);
  const prefetchUntilPosRef = useRef(0);
  const bgReadySrcSetRef = useRef<Set<string>>(new Set());

  const bumpHeroLoadedVersion = () => setHeroLoadedVersion((v) => v + 1);

  const slideKeyOf = (s?: HeroDetail) => (s ? `${s.type}-${s.id}` : '');

  const getDisplayedPosterSrc = (slide?: HeroDetail) => {
    if (!slide) return '';
    const key = slideKeyOf(slide);
    return heroPosterByKeyRef.current[key] || slide.imageUrl || '';
  };

  const toHeroBgSrc = (url: string) => {
    if (!url) return '';
    try {
      return toSiteTmdbImageUrl(downscaleTmdb(toSiteTmdbImageUrl(url), HERO_BG_SIZE));
    } catch {
      return url;
    }
  };

  const getImageCandidates = (resolvedUrl: string, downscaleSize: string) => {
    const candidates = new Set<string>();
    if (resolvedUrl) candidates.add(resolvedUrl);

    try {
      const inner = toSiteTmdbImageUrl(resolvedUrl);
      if (inner.startsWith('/tmdb-images/') || inner.startsWith('/tmdb/')) {
        candidates.add(toSiteTmdbImageUrl(downscaleTmdb(inner, downscaleSize)));
      }
      if (inner.startsWith('http://') || inner.startsWith('https://')) {
        candidates.add(inner);
      }
    } catch {
    }

    return Array.from(candidates).filter(Boolean);
  };

  const loadImage = (url: string) =>
    new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          if (typeof (img as any).decode === 'function') {
            await (img as any).decode();
          }
          resolve();
        } catch {
          resolve();
        }
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.decoding = 'async' as any;
      img.src = url;
    });

  const ensureBgImageReady = async (url: string) => {
    if (!url) return false;
    if (bgReadySrcSetRef.current.has(url)) return true;
    try {
      await loadImage(url);
      bgReadySrcSetRef.current.add(url);
      return true;
    } catch {
      return false;
    }
  };

  const ensurePosterLoaded = async (slide?: HeroDetail) => {
    if (!slide) return undefined;
    const key = slideKeyOf(slide);
    if (!key) return undefined;
    const cached = heroPosterByKeyRef.current[key];
    if (cached) return cached;

    const candidates = getImageCandidates(slide.imageUrl, HERO_IMAGE_SIZE);
    for (const u of candidates) {
      try {
        await loadImage(u);
        heroPosterByKeyRef.current[key] = u;
        bgReadySrcSetRef.current.add(u);
        const bgSrc = toHeroBgSrc(u);
        if (bgSrc) {
          bgReadySrcSetRef.current.add(bgSrc);
          void ensureBgImageReady(bgSrc);
        }
        bumpHeroLoadedVersion();
        return u;
      } catch {
      }
    }
    return undefined;
  };

  const ensureLogoLoaded = async (slide?: HeroDetail) => {
    if (!slide) return undefined;
    const key = slideKeyOf(slide);
    if (!key) return undefined;
    const cached = heroLogoByKeyRef.current[key];
    if (cached) return cached;

    if (!slide.logoUrl) return undefined;
    const candidates = getImageCandidates(slide.logoUrl, HERO_IMAGE_SIZE);
    for (const u of candidates) {
      try {
        await loadImage(u);
        heroLogoByKeyRef.current[key] = u;
        bumpHeroLoadedVersion();
        return u;
      } catch {
      }
    }
    return undefined;
  };

  const ensurePosterAndLogoLoaded = async (slide?: HeroDetail) => {
    await Promise.allSettled([ensurePosterLoaded(slide), ensureLogoLoaded(slide)]);
  };

  const ensureBgForSlide = async (slide?: HeroDetail) => {
    const src = toHeroBgSrc(getDisplayedPosterSrc(slide));
    if (!src) return false;
    return await ensureBgImageReady(src);
  };

  const waitForLogoUrl = async (slideIdx: number, timeoutMs: number) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const logoUrl = slidesRef.current[slideIdx]?.logoUrl;
      if (logoUrl) return;
      await new Promise((r) => setTimeout(r, 80));
    }
  };

  const detailsQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ['hero-detail', item.type, item.id, 'poster-hero'],
      queryFn: async () => {
        const res = await fetch(
          buildTmdbApiUrl(`${item.type}/${item.id}`, {
            language: 'zh-CN',
            append_to_response: 'images',
            include_image_language: `zh,cn,${NO_LANG},en`,
          })
        );
        if (!res.ok) throw new Error('加载轮播详情失败');
        const data = await res.json();
        const title = item.type === 'movie' ? data.title : data.name;
        return {
          id: item.id,
          type: item.type,
          title: title || item.title,
          genres: (data.genres || []).map((g: { name: string }) => g.name).slice(0, 3),
          logoUrl: resolveHeroImageUrl(pickLogo(data.images?.logos || [])),
          imageUrl: resolveHeroImageUrl(pickHeroPosterImage(data.images, item.poster)),
          poster: item.poster,
        } as HeroDetail;
      },
      staleTime: 5 * 60 * 1000,
    })),
  });

  const slides: HeroDetail[] = detailsQueries.map((q, idx) => q.data || {
    id: items[idx].id,
    type: items[idx].type,
    title: items[idx].title,
    genres: [],
    logoUrl: '',
    imageUrl: resolveHeroImageUrl(items[idx].poster),
    poster: items[idx].poster,
  });

  const slidesRef = useRef<HeroDetail[]>(slides);
  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  const [segments, setSegments] = useState<number[][]>([]);
  const [currentSegment, setCurrentSegment] = useState(0);
  const [currentIndexInSegment, setCurrentIndexInSegment] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const [heroBg, setHeroBg] = useState<{ layer0: string; layer1: string; top: 0 | 1 } | null>(null);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const touchStartTime = useRef(0);
  const lastMoveX = useRef(0);
  const lastMoveTime = useRef(0);
  const velocityX = useRef(0);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const playbackIndices = useMemo(() => segments.flat(), [segments]);
  const activePos = useMemo(() => {
    let prefix = 0;
    for (let i = 0; i < currentSegment; i++) prefix += segments[i]?.length || 0;
    return prefix + currentIndexInSegment;
  }, [segments, currentSegment, currentIndexInSegment]);

  const posToSegmentState = useCallback(
    (pos: number) => {
      let remain = pos;
      for (let segIdx = 0; segIdx < segments.length; segIdx++) {
        const len = segments[segIdx]?.length ?? 0;
        if (remain < len) return { segIdx, indexInSeg: remain };
        remain -= len;
      }
      return { segIdx: 0, indexInSeg: 0 };
    },
    [segments],
  );

  const generateSegments = useCallback(() => {
    const total = slides.length;
    if (total === 0) return [];

    const allIndices = Array.from({ length: total }, (_, i) => i);
    const shuffled = [...allIndices];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const segs: number[][] = [];
    let remaining = shuffled;
    for (let i = 0; i < 3; i++) {
      const take = Math.min(SEGMENT_SIZE, remaining.length);
      if (take === 0) break;
      const segment = remaining.slice(0, take);
      segs.push(segment);
      remaining = remaining.slice(take);
    }
    return segs;
  }, [slides.length]);

  useEffect(() => {
    if (slides.length === 0) return;
    const newSegments = generateSegments();
    setSegments(newSegments);
    setCurrentSegment(0);
    setCurrentIndexInSegment(0);
  }, [slides.length, generateSegments]);

  useEffect(() => {
    if (playbackIndices.length === 0) return;

    const seq = ++prefetchSeqRef.current;
    prefetchUntilPosRef.current = 0;

    void (async () => {
      const until = Math.min(4, playbackIndices.length);
      for (let pos = 0; pos < until; pos++) {
        if (prefetchSeqRef.current !== seq) return;
        const slideIdx = playbackIndices[pos];
        await waitForLogoUrl(slideIdx, 5000);
        const slide = slidesRef.current[slideIdx];
        await ensurePosterAndLogoLoaded(slide);
        await ensureBgForSlide(slide);
        prefetchUntilPosRef.current = pos + 1;
      }
    })();
  }, [playbackIndices]);

  useEffect(() => {
    if (playbackIndices.length === 0) return;

    const seq = prefetchSeqRef.current;
    const desiredUntil = Math.min(activePos + 4, playbackIndices.length);
    const from = prefetchUntilPosRef.current;
    if (desiredUntil <= from) return;

    void (async () => {
      for (let pos = from; pos < desiredUntil; pos++) {
        if (prefetchSeqRef.current !== seq) return;
        const slideIdx = playbackIndices[pos];
        await waitForLogoUrl(slideIdx, 2500);
        const slide = slidesRef.current[slideIdx];
        await ensurePosterAndLogoLoaded(slide);
        await ensureBgForSlide(slide);
        prefetchUntilPosRef.current = pos + 1;
      }
    })();
  }, [activePos, playbackIndices]);

  useEffect(() => {
    if (segments.length === 0 || carouselPaused) return;

    const mySeq = ++advanceSeqRef.current;

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        if (advanceSeqRef.current !== mySeq) return;

        if (playbackIndices.length === 0) return;

        const nextActivePos = activePos + 1;

        if (nextActivePos >= playbackIndices.length) {
          const newSegments = generateSegments();
          setSegments(newSegments);
          setCurrentSegment(0);
          setCurrentIndexInSegment(0);
          return;
        }

        const nextSlideIdx = playbackIndices[nextActivePos];
        const nextSlideForAdvance = slidesRef.current[nextSlideIdx];
        const nextNextPos = nextActivePos + 1;
        const nextNextSlideIdx = playbackIndices[nextNextPos];
        const nextNextSlideForAdvance =
          typeof nextNextSlideIdx === 'number' ? slidesRef.current[nextNextSlideIdx] : undefined;

        await waitForLogoUrl(nextSlideIdx, 2500);
        await ensurePosterAndLogoLoaded(nextSlideForAdvance);
        await ensureBgForSlide(nextSlideForAdvance);
        if (typeof nextNextSlideIdx === 'number') {
          await waitForLogoUrl(nextNextSlideIdx, 2500);
          if (nextNextSlideForAdvance) {
            await ensurePosterAndLogoLoaded(nextNextSlideForAdvance);
            await ensureBgForSlide(nextNextSlideForAdvance);
          }
        }

        if (advanceSeqRef.current !== mySeq) return;

        const { segIdx, indexInSeg } = posToSegmentState(nextActivePos);
        setCurrentSegment(segIdx);
        setCurrentIndexInSegment(indexInSeg);
      })();
    }, HERO_INTERVAL_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    segments,
    currentSegment,
    currentIndexInSegment,
    carouselPaused,
    generateSegments,
    playbackIndices,
    activePos,
    posToSegmentState,
  ]);

  const getAdjacentIndices = useCallback(() => {
    if (segments.length === 0) return { prev: -1, active: -1, next: -1 };
    const segment = segments[currentSegment];
    if (!segment) return { prev: -1, active: -1, next: -1 };
    const activeGlobal = segment[currentIndexInSegment];
    let prevGlobal = -1, nextGlobal = -1;

    if (currentIndexInSegment > 0) {
      prevGlobal = segment[currentIndexInSegment - 1];
    } else if (currentSegment > 0) {
      const prevSegment = segments[currentSegment - 1];
      if (prevSegment && prevSegment.length > 0) {
        prevGlobal = prevSegment[prevSegment.length - 1];
      }
    }

    if (currentIndexInSegment < segment.length - 1) {
      nextGlobal = segment[currentIndexInSegment + 1];
    } else if (currentSegment + 1 < segments.length) {
      const nextSegment = segments[currentSegment + 1];
      if (nextSegment && nextSegment.length > 0) {
        nextGlobal = nextSegment[0];
      }
    }

    return { prev: prevGlobal, active: activeGlobal, next: nextGlobal };
  }, [segments, currentSegment, currentIndexInSegment]);

  const { prev: prevGlobalIndex, active: activeGlobalIndex, next: nextGlobalIndex } = getAdjacentIndices();
  const activeSlide = activeGlobalIndex >= 0 ? slides[activeGlobalIndex] : undefined;
  const prevSlide = prevGlobalIndex >= 0 ? slides[prevGlobalIndex] : undefined;
  const nextSlide = nextGlobalIndex >= 0 ? slides[nextGlobalIndex] : undefined;

  const activeSlideKey = slideKeyOf(activeSlide);

  useLayoutEffect(() => {
    if (!activeSlideKey) return;
    const src = toHeroBgSrc(getDisplayedPosterSrc(activeSlide));
    if (!src) return;

    setHeroBg((prev) => {
      if (!prev) return { layer0: src, layer1: src, top: 0 };
      const currentShown = prev.top === 0 ? prev.layer0 : prev.layer1;
      if (src === currentShown) return prev;
      const behind = 1 - prev.top;
      return {
        layer0: behind === 0 ? src : prev.layer0,
        layer1: behind === 1 ? src : prev.layer1,
        top: behind as 0 | 1,
      };
    });

    void ensureBgImageReady(src);
  }, [activeSlideKey]);

  const handleTouchStart = (e: TouchEvent) => {
    const x = e.touches[0].clientX;
    const now = Date.now();
    touchStartX.current = x;
    touchEndX.current = x;
    touchStartTime.current = now;
    lastMoveX.current = x;
    lastMoveTime.current = now;
    velocityX.current = 0;
    setDragOffsetX(0);
    setIsDragging(true);
    setCarouselPaused(true);
  };
  const handleTouchMove = (e: TouchEvent) => {
    const x = e.touches[0].clientX;
    const now = Date.now();
    touchEndX.current = x;
    const dt = Math.max(1, now - lastMoveTime.current);
    velocityX.current = (x - lastMoveX.current) / dt;
    lastMoveX.current = x;
    lastMoveTime.current = now;
    const rawOffset = x - touchStartX.current;
    setDragOffsetX(Math.max(-140, Math.min(140, rawOffset)));
  };
  const handleTouchEnd = async () => {
    const delta = touchStartX.current - touchEndX.current;
    const momentumDelta = delta - velocityX.current * 180;
    const swipeThreshold = 42;
    setIsDragging(false);
    setDragOffsetX(0);
    if (Math.abs(momentumDelta) < swipeThreshold) {
      setCarouselPaused(false);
      return;
    }

    const dir = momentumDelta > 0 ? 1 : -1;
    const playbackLen = playbackIndices.length;
    if (playbackLen === 0) {
      setCarouselPaused(false);
      return;
    }

    const targetPos = activePos + dir;

    if (dir > 0 && targetPos >= playbackLen) {
      const newSegments = generateSegments();
      setSegments(newSegments);
      setCurrentSegment(0);
      setCurrentIndexInSegment(0);
      setCarouselPaused(false);
      return;
    }

    if (dir < 0 && targetPos < 0) {
      setCarouselPaused(false);
      return;
    }

    const movedSlideIdx = playbackIndices[targetPos];
    const movedSlide = slidesRef.current[movedSlideIdx];
    const prevVisiblePos = targetPos - 1;
    const nextVisiblePos = targetPos + 1;
    const prevVisibleSlideIdx = prevVisiblePos >= 0 ? playbackIndices[prevVisiblePos] : undefined;
    const nextVisibleSlideIdx = nextVisiblePos < playbackLen ? playbackIndices[nextVisiblePos] : undefined;

    await waitForLogoUrl(movedSlideIdx, 2500);
    await ensurePosterAndLogoLoaded(movedSlide);
    await ensureBgForSlide(movedSlide);
    if (typeof prevVisibleSlideIdx === 'number') {
      await waitForLogoUrl(prevVisibleSlideIdx, 2500);
      await ensurePosterAndLogoLoaded(slidesRef.current[prevVisibleSlideIdx]);
      await ensureBgForSlide(slidesRef.current[prevVisibleSlideIdx]);
    }
    if (typeof nextVisibleSlideIdx === 'number') {
      await waitForLogoUrl(nextVisibleSlideIdx, 2500);
      await ensurePosterAndLogoLoaded(slidesRef.current[nextVisibleSlideIdx]);
      await ensureBgForSlide(slidesRef.current[nextVisibleSlideIdx]);
    }

    const { segIdx, indexInSeg } = posToSegmentState(targetPos);
    setCurrentSegment(segIdx);
    setCurrentIndexInSegment(indexInSeg);

    setCarouselPaused(false);
  };

  if (!activeSlide) return null;

  const currentSegmentLength = segments[currentSegment]?.length || 0;

  const cardTransitionDuration = 800;
  const cardEasing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  const bgTransitionMs = cardTransitionDuration;
  const bgEase = cardEasing;
  const bgScaleIn = 1.03;
  const bgScaleOut = 1.08;

  return (
    <section
      className="relative z-[1] flex w-full min-h-0 flex-1 flex-col overflow-x-hidden max-lg:min-h-0 max-lg:[--home-nav-poster:clamp(0.375rem,1.6vw,0.5rem)] max-lg:[--home-poster-list-band:clamp(2.75rem,12vh,5.25rem)] max-lg:overflow-y-visible lg:max-h-full lg:overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* 全屏模糊背景 */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {heroBg ? (
          <>
            <img
              src={heroBg.layer0}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              loading="eager"
              decoding="async"
              style={{
                filter: 'blur(60px)',
                opacity: heroBg.top === 0 ? 1 : 0,
                transform: heroBg.top === 0 ? `scale(${bgScaleIn})` : `scale(${bgScaleOut})`,
                transition: `opacity ${bgTransitionMs}ms ${bgEase}, transform ${bgTransitionMs}ms ${bgEase}`,
                willChange: 'opacity, transform',
                zIndex: heroBg.top === 0 ? 2 : 1,
              }}
            />
            <img
              src={heroBg.layer1}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              loading="eager"
              decoding="async"
              style={{
                filter: 'blur(60px)',
                opacity: heroBg.top === 1 ? 1 : 0,
                transform: heroBg.top === 1 ? `scale(${bgScaleIn})` : `scale(${bgScaleOut})`,
                transition: `opacity ${bgTransitionMs}ms ${bgEase}, transform ${bgTransitionMs}ms ${bgEase}`,
                willChange: 'opacity, transform',
                zIndex: heroBg.top === 1 ? 2 : 1,
              }}
            />
          </>
        ) : (
          <div
            className="absolute inset-0 h-full w-full bg-gradient-to-br from-gray-900/45 via-gray-800/25 to-black/55"
            style={{
              filter: 'blur(24px)',
              transform: `scale(${bgScaleIn})`,
            }}
          />
        )}
        <div className="absolute inset-0 bg-black/50" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col max-lg:pt-[max(4.75rem,calc(env(safe-area-inset-top,0px)+3.5rem))] max-lg:pb-2 lg:pt-16 lg:h-full lg:max-h-full">
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-3 max-lg:gap-0 lg:flex-row lg:gap-6 lg:px-6 xl:gap-8 xl:px-8 lg:pb-4">
          {/* 左侧桌面端榜单 */}
          <div className="hidden min-h-0 min-w-0 flex-[1.15] flex-col gap-2 self-stretch lg:flex lg:overflow-visible">
            <TopSectionsPanel chartData={chartData} isLoading={chartsLoading} variant="desktop" />
          </div>

          {/* 右侧轮播区域（三张卡片） */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-start max-lg:mt-[var(--home-nav-poster)] lg:justify-center lg:flex-[0.85] lg:max-w-[min(44vw,440px)]">
            <div className="relative flex w-full items-center justify-center py-3 sm:py-6 max-lg:py-0">
              <div
                className="relative flex w-full max-w-full items-center justify-center max-lg:min-h-[calc(min(68vw,280px)*1.5)] sm:max-lg:min-h-[calc(min(48vw,320px)*1.5)] lg:min-h-[clamp(280px,45vh,460px)]"
                style={{ perspective: '2000px', perspectiveOrigin: '50% 50%' }}
              >
                {/* 三张卡片：左、中、右 */}
                {[
                  { slide: prevSlide, isActive: false, offset: -1 },
                  { slide: activeSlide, isActive: true, offset: 0 },
                  { slide: nextSlide, isActive: false, offset: 1 },
                ].map(({ slide, isActive, offset }) => {
                  if (!slide) return null;
                  const slideKey = slideKeyOf(slide);
                  const posterSrc = heroPosterByKeyRef.current[slideKey] || slide.imageUrl || '';
                  const logoSrc = heroLogoByKeyRef.current[slideKey] || slide.logoUrl || '';
                  const translateX = offset === 0 ? '0%' : `${offset * 60}%`;
                  const scale = isActive ? 1 : 0.8;
                  const opacity = isActive ? 1 : 0.6;
                  const zIndex = isActive ? 30 : 10;
                  return (
                    <Link
                      key={slideKey || `${offset}`}
                      to={`/${slide.type}/${slide.id}`}
                      className="absolute transition-all will-change-transform"
                      onMouseEnter={() => setCarouselPaused(true)}
                      onMouseLeave={() => setCarouselPaused(false)}
                      style={{
                        transform: `translateX(calc(${translateX} + ${dragOffsetX}px)) scale(${scale})`,
                        opacity,
                        zIndex,
                        transitionDuration: isDragging ? '0ms' : `${cardTransitionDuration}ms`,
                        transitionTimingFunction: cardEasing,
                      }}
                    >
                      <div className="relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-black/20 dark:ring-white/15 aspect-[2/3] w-[min(68vw,280px)] sm:w-[min(48vw,320px)] lg:w-[min(28vh,260px)]">
                        {posterSrc ? (
                          <img
                            src={posterSrc}
                            alt={slide.title}
                            className="h-full w-full object-cover"
                            decoding="async"
                            loading={isActive ? 'eager' : 'lazy'}
                            fetchPriority={isActive ? 'high' : 'auto'}
                            style={{
                              objectPosition: 'center 30%',
                              opacity: 0,
                              transition: 'opacity 0.25s ease-out',
                            }}
                            onLoad={(e) => {
                              const target = e.target as HTMLImageElement;
                              if (target && target.complete && target.naturalWidth > 0) {
                                requestAnimationFrame(() => {
                                  target.style.opacity = '1';
                                });
                              }
                            }}
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              if (target) target.style.opacity = '0';
                            }}
                            crossOrigin="anonymous"
                          />
                        ) : (
                          <div className="h-full w-full bg-gray-200 dark:bg-gray-800" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                        <div className="absolute bottom-3 left-3 right-3 text-center sm:bottom-4">
                          {logoSrc ? (
                            <img
                              src={logoSrc}
                              alt={slide.title}
                              className="mx-auto max-h-8 object-contain sm:max-h-10"
                              decoding="async"
                              loading={isActive ? 'eager' : 'lazy'}
                            />
                          ) : (
                            <h2
                              className="text-sm font-bold text-white sm:text-lg"
                              style={HERO_TITLE_SHADOW}
                            >
                              {slide.title}
                            </h2>
                          )}
                          <p className="mt-1 text-[9px] leading-tight text-gray-200 sm:text-[10px] whitespace-nowrap overflow-hidden text-ellipsis">
                            {(slide.genres || []).slice(0, 3).join('·')}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="relative z-20 flex w-full shrink-0 justify-center gap-2 max-lg:min-h-[var(--home-poster-list-band)] max-lg:items-center max-lg:py-0 lg:mt-0 lg:min-h-0 lg:w-auto lg:items-center lg:pb-0 lg:pt-2">
              {Array.from({ length: currentSegmentLength }, (_, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={`第 ${idx + 1} 张`}
                  onClick={() => {
                    const targetPos = (() => {
                      let prefix = 0;
                      for (let i = 0; i < currentSegment; i++) prefix += segments[i]?.length || 0;
                      return prefix + idx;
                    })();
                    const slideIdx = playbackIndices[targetPos];
                    const slide = typeof slideIdx === 'number' ? slidesRef.current[slideIdx] : undefined;
                    setCarouselPaused(true);
                    void (async () => {
                      await waitForLogoUrl(slideIdx, 2500);
                      await ensurePosterAndLogoLoaded(slide);
                      await ensureBgForSlide(slide);
                      setCurrentIndexInSegment(idx);
                      setCarouselPaused(false);
                    })();
                  }}
                  className={`rounded-full transition-all ${
                    idx === currentIndexInSegment ? 'h-2 w-6 bg-white' : 'h-2 w-2 bg-white/50'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* 底部移动端榜单 */}
        <div className="shrink-0 border-t border-white/5 px-4 pb-8 pt-8 max-lg:border-t-0 max-lg:pt-0 lg:hidden">
          <TopSectionsPanel chartData={chartData} isLoading={chartsLoading} variant="mobile" />
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  usePageMeta({
    title: 'RateFuse - 搜索并对比多平台影视评分',
    description: '搜索电影与剧集，一键对比豆瓣、IMDb、烂番茄、Metacritic、TMDB 等多平台评分，并查看热门榜单。',
    canonicalPath: '/',
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'movies' | 'tvShows' | 'users'>('movies');

  const location = useLocation();
  const searchFromState = location.state?.searchQuery;
  const clearSearchFromState = location.state?.clearSearch;
  const navigate = useNavigate();

  const { user, isLoading: authLoading } = useAuth();
  const USER_PAGE_SIZE = 10;

  const {
    data: mediaSearchData,
    isLoading: mediaLoading,
    error: mediaError,
  } = useQuery({
    queryKey: ['search', searchQuery, page],
    queryFn: () => searchMedia(searchQuery, { page }),
    enabled: !!searchQuery && activeTab !== 'users',
    placeholderData: (previousData) => previousData,
  });

  const {
    data: userSearchData,
    isLoading: userLoading,
    error: userError,
  } = useQuery({
    queryKey: ['search-users', searchQuery, page],
    queryFn: () =>
      searchUsers({
        q: searchQuery,
        limit: USER_PAGE_SIZE,
        offset: (page - 1) * USER_PAGE_SIZE,
      }),
    enabled: !!searchQuery && activeTab === 'users' && !!user && !authLoading,
    placeholderData: (previousData) => previousData,
  });

  const [userResults, setUserResults] = useState<UserSearchItem[]>([]);
  const [pendingUnfollowUser, setPendingUnfollowUser] = useState<UserSearchItem | null>(null);

  useEffect(() => {
    if (userSearchData?.list) setUserResults(userSearchData.list);
    else setUserResults([]);
  }, [userSearchData?.list]);

  const toggleUserFollow = async (target: UserSearchItem) => {
    const wasFollowing = !!target.is_following;
    setUserResults((prev) =>
      prev.map((item) =>
        item.id === target.id ? { ...item, is_following: !wasFollowing } : item,
      ),
    );
    try {
      const res = await authFetch(`/api/users/${target.id}/follow`, {
        method: wasFollowing ? 'DELETE' : 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || '操作失败');
      }
      toast.success(wasFollowing ? '取消关注成功' : '关注成功');
    } catch (e: any) {
      setUserResults((prev) =>
        prev.map((item) =>
          item.id === target.id ? { ...item, is_following: wasFollowing } : item,
        ),
      );
      toast.error(e?.message || '操作失败');
    }
  };

  useEffect(() => {
    if (searchFromState) {
      setSearchQuery(searchFromState);
      setActiveTab('movies');
      setPage(1);
      navigate('/', { replace: true });
    }
  }, [searchFromState, navigate]);

  useEffect(() => {
    if (!clearSearchFromState) return;
    setSearchQuery('');
    setActiveTab('movies');
    setPage(1);
    navigate('/', { replace: true });
  }, [clearSearchFromState, navigate]);

  useEffect(() => {
    if (!searchQuery) return;
    setPage(1);
  }, [activeTab, searchQuery]);

  const { data: chartData, isLoading: chartsLoading } = useQuery({
    queryKey: ['aggregate-charts'],
    queryFn: () => fetch('/api/charts/aggregate').then((r) => r.json()),
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const heroItems = useMemo(() => {
    const all = [
      ...(chartData?.top_movies || []),
      ...(chartData?.top_tv || []),
      ...(chartData?.top_chinese_tv || []),
    ] as TopItem[];
    const shuffledAll = shuffle(all);
    return shuffledAll.slice(0, HERO_POOL_SIZE);
  }, [chartData]);

  useEffect(() => {
    if (searchQuery) {
      document.documentElement.classList.remove('home-hero-active');
      return;
    }
    document.documentElement.classList.add('home-hero-active');
    return () => document.documentElement.classList.remove('home-hero-active');
  }, [searchQuery]);

  return (
    <div className="safe-area-bottom relative flex min-h-screen flex-col">
      <ThemeToggle />
      <NavBar panelClassName="nav-glass-exempt" />

      {!searchQuery && (
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden max-lg:flex-none max-lg:overflow-visible lg:min-h-0 lg:max-h-[100dvh]">
          <HeroCarousel items={heroItems} chartData={chartData} chartsLoading={chartsLoading} />
        </div>
      )}

      {searchQuery ? (
        <div className="container mx-auto flex w-full flex-1 flex-col px-4 pt-16 pb-8">
          <div className="mt-4 flex w-full flex-col gap-5 sm:gap-6">
            {/* 顶部类型切换 */}
            <div className="flex w-full justify-center pt-1">
              <div className="flex w-full max-w-md items-center justify-center gap-2 overflow-x-auto whitespace-nowrap px-1 py-1 overflow-y-visible scrollbar-hide">
                {(
                  [
                    { id: 'movies', label: '电影' },
                    { id: 'tvShows', label: '剧集' },
                    { id: 'users', label: '用户' },
                  ] as const
                ).map((t) => {
                  const isActive = activeTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTab(t.id)}
                      aria-pressed={isActive}
                      className={[
                        'home-top-tone-button min-w-[84px] flex-1 rounded-full px-3 py-2 text-sm font-medium outline-none no-hover-scale',
                        'backdrop-blur-sm',
                        isActive
                          ? 'is-active opacity-100'
                          : 'opacity-75 hover:opacity-90',
                      ].join(' ')}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 结果列表 */}
            <div className="min-w-0">
              {activeTab === 'users' ? (
                <>
                  {authLoading || userLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
                      <span className="ml-3 text-gray-600 dark:text-gray-400">{messages.loading}</span>
                    </div>
                  ) : userError ? (
                    <div className="text-center py-12">
                      <p className="text-gray-600 dark:text-gray-400">
                        {userError instanceof Error ? userError.message : messages.errors.loadRatingsFailed}
                      </p>
                    </div>
                  ) : !user ? (
                    <div className="text-center py-12">
                      <p className="text-gray-600 dark:text-gray-400">请先登录后搜索用户</p>
                    </div>
                  ) : !userSearchData || userResults.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-gray-600 dark:text-gray-400">未找到相关用户</p>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-3">
                        {userResults.map((u) => (
                          <div
                            key={u.id}
                            className="glass-card rounded-2xl p-4 flex items-center justify-between gap-4 ring-1 ring-white/10 dark:ring-white/5"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <img
                                src={u.avatar || '/default-avatar.png'}
                                alt={u.username}
                                className="w-10 h-10 rounded-full object-cover"
                                loading="lazy"
                              />
                              <div className="min-w-0">
                                <Link
                                  to={`/profile/${u.id}`}
                                  className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate hover:text-blue-500 dark:hover:text-blue-400"
                                >
                                  {u.username}
                                </Link>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={async () => {
                                if (u.is_following) {
                                  setPendingUnfollowUser(u);
                                  return;
                                }
                                await toggleUserFollow(u);
                              }}
                              className={[
                                'px-3 py-1.5 rounded-full text-sm transition-opacity hover:opacity-90 no-hover-scale',
                                u.is_following
                                  ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                                  : 'bg-blue-500 text-white',
                              ].join(' ')}
                            >
                              {u.is_following ? '已关注' : '关注'}
                            </button>
                          </div>
                        ))}
                      </div>

                      {userSearchData && (
                        <Pagination
                          currentPage={page}
                          totalPages={Math.max(1, Math.ceil(userSearchData.total / USER_PAGE_SIZE))}
                          onPageChange={setPage}
                        />
                      )}
                      <ConfirmDialog
                        open={pendingUnfollowUser !== null}
                        title="取消关注"
                        message={`确定要取消关注「${pendingUnfollowUser?.username || ''}」吗？`}
                        confirmText="确定"
                        cancelText="取消"
                        onCancel={() => setPendingUnfollowUser(null)}
                        onConfirm={() => {
                          const target = pendingUnfollowUser;
                          setPendingUnfollowUser(null);
                          if (target) {
                            void toggleUserFollow(target);
                          }
                        }}
                      />
                    </>
                  )}
                </>
              ) : (
                <>
                  {mediaLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
                      <span className="ml-3 text-gray-600 dark:text-gray-400">{messages.loading}</span>
                    </div>
                  ) : mediaError ? (
                    <div className="text-center py-12">
                      <p className="text-gray-600 dark:text-gray-400">
                        {mediaError instanceof Error ? mediaError.message : messages.errors.loadRatingsFailed}
                      </p>
                    </div>
                  ) : !mediaSearchData ? (
                    <div className="text-center py-12">
                      <p className="text-gray-600 dark:text-gray-400">{messages.errors.noResults}</p>
                    </div>
                  ) : activeTab === 'movies' ? (
                    (() => {
                      const items = mediaSearchData.movies?.results || [];
                      const totalPages = mediaSearchData.movies?.totalPages || 1;
                      if (items.length === 0) {
                        return (
                          <div className="text-center py-12">
                            <p className="text-gray-600 dark:text-gray-400">{messages.errors.noResults}</p>
                          </div>
                        );
                      }
                      return (
                        <SearchResults
                          items={items}
                          totalPages={totalPages}
                          currentPage={page}
                          onPageChange={setPage}
                        />
                      );
                    })()
                  ) : (
                    (() => {
                      const items = mediaSearchData.tvShows?.results || [];
                      const totalPages = mediaSearchData.tvShows?.totalPages || 1;
                      if (items.length === 0) {
                        return (
                          <div className="text-center py-12">
                            <p className="text-gray-600 dark:text-gray-400">{messages.errors.noResults}</p>
                          </div>
                        );
                      }
                      return (
                        <SearchResults
                          items={items}
                          totalPages={totalPages}
                          currentPage={page}
                          onPageChange={setPage}
                        />
                      );
                    })()
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <Footer variant={searchQuery ? 'default' : 'onDark'} />
    </div>
  );
}
