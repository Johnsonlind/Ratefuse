// ==========================================
// 图片 URL 与图片数据处理 API
// ==========================================
import { TMDB } from './api';

const TMDB_IMAGE_BASE = 'https://tmdb.ratefuse.cn/t/p';

type ImageSize = keyof typeof TMDB.posterSizes;

export function getImageUrl(path: string | null, size: ImageSize = '中', type: 'poster' | 'profile' = 'poster'): string {
  if (!path) {
    return type === 'poster' ? '/placeholder-poster.png' : '/placeholder-avatar.png';
  }
  if (path.startsWith('http')) {
    if (path.includes('tmdb.ratefuse.cn')) return path;
    return `/api/image-proxy?url=${encodeURIComponent(path)}`;
  }
  if (!path.startsWith('/')) path = '/' + path;
  return `${TMDB_IMAGE_BASE}/${TMDB.posterSizes[size]}${path}`;
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
  
  const imageUrl = input.startsWith('http') 
    ? `/api/image-proxy?url=${encodeURIComponent(input)}`
    : input;
  
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
