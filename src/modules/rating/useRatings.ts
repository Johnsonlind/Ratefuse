// ==========================================
// 评分数据拉取 Hook
// ==========================================
import useSWR from 'swr';
import type { RatingData } from '../../modules/rating/ratings';

const API_URL = import.meta.env.VITE_API_URL;

const fetcher = async (url: string): Promise<any> => {
  const maxRetries = 2;
  let retries = 0;
  let lastError;
  
  while (retries <= maxRetries) {
    try {
      const response = await fetch(url, {
        headers: {
          'Cache-Control': 'max-age=3600'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (err) {
      lastError = err;
      retries++;
      
      if (retries <= maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries - 1)));
      }
    }
  }
  
  throw lastError;
};

export function useRatings(type: 'movie' | 'tv', id: string) {
  const { data, error, isLoading, mutate } = useSWR<RatingData>(
    id ? `${API_URL}/ratings/${type}/${id}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      dedupingInterval: 3600000,
      errorRetryCount: 2,
    }
  );

  return {
    data,
    isLoading,
    error,
    mutate
  };
}
