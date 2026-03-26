// ==========================================
// 评分格式化工具
// ==========================================
import { isNil } from 'lodash';

type RatingValue = string | number | undefined | null;

export const formatRating = {
  number: (value: RatingValue, defaultValue = 0): number => {
    if (isNil(value) || value === '暂无' || value === 'tbd') return defaultValue;
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  },

  percentage: (value: RatingValue): number | undefined => {
    if (isNil(value) || value === '暂无' || value === '0' || value === 'tbd') {
      return undefined;
    }
    
    if (typeof value === 'string' && value.includes('%')) {
      value = value.replace('%', '');
    }
    
    const numValue = typeof value === 'string' ? parseInt(value) : Number(value);
    return numValue > 0 ? numValue : undefined;
  },

  count: (value: RatingValue): string => {
    if (isNil(value) || value === '暂无' || value === 'tbd') return '0';
    
    if (typeof value === 'string') {
      if (value.includes('M') || value.includes('K')) {
        return value;
      }
      const numStr = value.replace(/[^0-9.+]/g, '');
      if (numStr.includes('+')) {
        return numStr;
      }
      value = Number(numStr);
    }

    const num = Number(value);
    return isNaN(num) ? '0' : num.toLocaleString();
  },

  tmdb: (value: RatingValue): string | number => {
    if (isNil(value)) return '暂无';
    const num = Number(value);
    return isNaN(num) ? '暂无' : Number(num.toFixed(1));
  },

  letterboxd: (value: RatingValue): number => {
    if (isNil(value) || value === '暂无' || value === 'tbd') return 0;
    const rating = Number(value);
    return isNaN(rating) ? 0 : Number((rating * 2).toFixed(1));
  }
};
