// ==========================================
// 图片 URL 与图片数据处理 API
// ==========================================
import { TMDB } from './api';

type ImageSize = keyof typeof TMDB.posterSizes;

const TMDB_IMAGE_FILE_RE = /\.(?:jpe?g|png|webp|gif)$/i;

function collapseTmdbImagePrefixes(input: string): string {
  let p = input.replace(/\/tmdb-images\//g, '/tmdb/');
  while (p.includes('/tmdb/tmdb/')) {
    p = p.replace(/\/tmdb\/tmdb\//g, '/tmdb/');
  }
  return p;
}

function normalizeRelativeTmdbSitePath(input: string): string {
  let p = input.startsWith('/') ? input : `/${input}`;
  p = collapseTmdbImagePrefixes(p);
  const tail = p.match(/\/(original|w\d+)\/([^/]+\.(?:jpe?g|png|webp|gif))$/i);
  if (tail) {
    return `/tmdb/${tail[1]}/${tail[2]}`;
  }
  return p;
}

export function toSiteTmdbImageUrl(input: string): string {
  if (!input) return input;
  if (input.startsWith('http')) {
    try {
      const parsed = new URL(input);
      if (
        (parsed.hostname === 'image.tmdb.org' || parsed.hostname === 'tmdb.ratefuse.cn') &&
        parsed.pathname.startsWith('/t/p/')
      ) {
        const rest = parsed.pathname.slice('/t/p/'.length);
        return normalizeRelativeTmdbSitePath(`/tmdb/${rest}`);
      }
    } catch {
    }
    return input;
  }
  if (input.startsWith('/')) {
    return normalizeRelativeTmdbSitePath(input);
  }
  return input;
}

export function posterPathToSiteUrl(poster: string, width: string): string {
  if (!poster) return '';

  const tmdbPattern = /https?:\/\/image\.tmdb\.org\/t\/p\/(original|w\d+)(\/.+)/i;
  const m = poster.match(tmdbPattern);
  if (m) {
    return toSiteTmdbImageUrl(`https://tmdb.ratefuse.cn/t/p/${width}${m[2]}`);
  }

  if (poster.startsWith('http')) {
    return toSiteTmdbImageUrl(poster);
  }

  const p = normalizeRelativeTmdbSitePath(poster.startsWith('/') ? poster : `/${poster}`);
  const sized = p.match(/^\/tmdb\/(original|w\d+)\/(.+)$/i);
  if (sized && TMDB_IMAGE_FILE_RE.test(sized[2])) {
    return `/tmdb/${width}/${sized[2]}`;
  }
  if (/^\/[^/]+\.(?:jpe?g|png|webp|gif)$/i.test(p)) {
    return `/tmdb/${width}${p}`;
  }
  if (p.startsWith('/tmdb/')) {
    return p;
  }
  const p2 = p.startsWith('/') ? p : `/${p}`;
  return `/tmdb/${width}${p2}`;
}

export function getImageUrl(path: string | null, size: ImageSize = '中', type: 'poster' | 'profile' = 'poster'): string {
  if (!path) {
    return type === 'poster' ? '/placeholder-poster.png' : '/placeholder-avatar.png';
  }
  if (path.startsWith('http')) {
    return toSiteTmdbImageUrl(path);
  }
  const p = normalizeRelativeTmdbSitePath(path.startsWith('/') ? path : `/${path}`);
  const sz = TMDB.posterSizes[size];
  const sized = p.match(/^\/tmdb\/(original|w\d+)\/(.+)$/i);
  if (sized && TMDB_IMAGE_FILE_RE.test(sized[2])) {
    return `/tmdb/${sz}/${sized[2]}`;
  }
  if (/^\/[^/]+\.(?:jpe?g|png|webp|gif)$/i.test(p)) {
    return `/tmdb/${sz}${p}`;
  }
  if (p.startsWith('/tmdb/')) {
    return p;
  }
  return `/tmdb/${sz}${p.startsWith('/') ? p : `/${p}`}`;
}

export async function getBase64Image(input: string | File): Promise<string> {
  return getBase64ImageWithOptions(input);
}

export async function getBase64ImageWithOptions(
  input: string | File,
  options?: { cacheBust?: boolean }
): Promise<string> {
  if (input instanceof File) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(input);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  }

  const imageUrl = toSiteTmdbImageUrl(input);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        const base64 = canvas.toDataURL('image/png');
        console.log('Base64 conversion successful (PNG format)');
        resolve(base64);
      } catch (error) {
        console.error('Error during base64 conversion:', error);
        reject(error);
      }
    };

    img.onerror = (error) => {
      console.error('Error loading image:', error);
      reject(new Error('Failed to load image'));
    };

    const cacheBust = options?.cacheBust ?? false;
    img.src = cacheBust ? `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}t=${Date.now()}` : imageUrl;
  });
}
