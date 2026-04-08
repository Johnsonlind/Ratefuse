// ==========================================
// 通用工具函数集合
// ==========================================
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { toSiteTmdbImageUrl } from '../../api/image';
import { TZ_CHINA } from './time';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function calculateAverageRating(ratings?: Record<string, number | null | undefined>) {
  if (!ratings) return 0;
  
  const validRatings = Object.values(ratings)
    .filter((rating): rating is number => 
      typeof rating === 'number' && !isNaN(rating)
    );

  if (validRatings.length === 0) return 0;

  const sum = validRatings.reduce((acc, rating) => acc + rating, 0);
  return sum / validRatings.length;
}

export function formatDate(dateString: string): string {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: TZ_CHINA,
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(date);
  } catch (error) {
    console.error('Date formatting error:', error);
    return dateString;
  }
}

export function getImageUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http')) return toSiteTmdbImageUrl(path);
  const p = path.startsWith('/') ? path : `/${path}`;
  return toSiteTmdbImageUrl(p);
}

export function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes}分钟`;
}
