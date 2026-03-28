// ==========================================
// 图片 URL 与图片数据处理 API
// ==========================================
import { TMDB } from './api';

type ImageSize = keyof typeof TMDB.posterSizes;

export function toSiteTmdbImageUrl(input: string): string {
  if (!input) return input;
  if (input.startsWith('/tmdb/')) return input;
  if (input.startsWith('/tmdb-images/')) {
    return `/tmdb/${input.slice('/tmdb-images/'.length)}`;
  }
  if (input.startsWith('/api/image-proxy')) {
    try {
      const u = new URL(input, 'https://ratefuse.cn');
      const raw = u.searchParams.get('url');
      if (raw) return toSiteTmdbImageUrl(decodeURIComponent(raw));
    } catch {
    }
    return input;
  }
  if (input.startsWith('http')) {
    try {
      const parsed = new URL(input);
      if (
        (parsed.hostname === 'image.tmdb.org' || parsed.hostname === 'tmdb.ratefuse.cn') &&
        parsed.pathname.startsWith('/t/p/')
      ) {
        const rest = parsed.pathname.slice('/t/p/'.length);
        return `/tmdb/${rest}`;
      }
    } catch {
    }
    return input;
  }
  return input;
}

export function posterPathToSiteUrl(poster: string, width: string): string {
  if (!poster) return '';
  if (poster.startsWith('/api/image-proxy')) {
    return toSiteTmdbImageUrl(poster);
  }

  const tmdbPattern = /https?:\/\/image\.tmdb\.org\/t\/p\/(original|w\d+)(\/.+)/i;
  const m = poster.match(tmdbPattern);
  if (m) {
    return toSiteTmdbImageUrl(`https://tmdb.ratefuse.cn/t/p/${width}${m[2]}`);
  }

  if (poster.startsWith('http')) {
    return toSiteTmdbImageUrl(poster);
  }

  if (poster.startsWith('/tmdb-images/')) {
    const path = poster.replace(/^\/tmdb-images\/(?:original|w\d+)/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `/tmdb/${width}${suffix}`;
  }

  if (poster.startsWith('/tmdb/')) {
    return poster;
  }

  const p = poster.startsWith('/') ? poster : `/${poster}`;
  return `/tmdb/${width}${p}`;
}

export function getImageUrl(path: string | null, size: ImageSize = '中', type: 'poster' | 'profile' = 'poster'): string {
  if (!path) {
    return type === 'poster' ? '/placeholder-poster.png' : '/placeholder-avatar.png';
  }
  if (path.startsWith('http')) {
    return toSiteTmdbImageUrl(path);
  }
  if (!path.startsWith('/')) path = '/' + path;
  return `/tmdb/${TMDB.posterSizes[size]}${path}`;
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
