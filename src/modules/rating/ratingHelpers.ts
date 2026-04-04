// ==========================================
// 评分辅助函数模块
// ==========================================
import type { DoubanSeasonRating, RottenTomatoesSeasonRating, MetacriticSeasonRating, TMDBSeasonRating, TraktSeasonRating } from '../../modules/rating/ratings';

/**
 * 安全解析投票数，如果解析失败或无效则返回中位数
 * @param value
 * @param median
 * @returns
 */
export function safeParseCount(value: string | number | undefined | null, median: number): number {
  if (value === undefined || value === null) return median;
  if (typeof value === 'number') {
    return isNaN(value) || value <= 0 ? median : value;
  }
  const str = String(value).trim();
  if (!str || str === '暂无' || str === 'tbd' || str === 'N/A') return median;
  const digits = str.replace(/[^0-9.]/g, '');
  if (!digits) return median;
  const num = parseFloat(digits);
  return isNaN(num) || num <= 0 ? median : num;
}

export function isValidRatingData(rating: string | number | undefined | null, count?: string | number | undefined | null): boolean {
  if (!rating) return false;
  if (typeof rating === 'string') {
    if (rating === '暂无' || rating === 'tbd' || rating === 'N/A' || rating === '0') return false;
    const numRating = parseFloat(rating);
    if (isNaN(numRating) || numRating === 0) return false;
  } else if (typeof rating === 'number') {
    if (rating === 0 || isNaN(rating)) return false;
  }

  if (count !== undefined) {
    if (!count) return false;
    if (typeof count === 'string') {
      if (count === '暂无' || count === '0' || count === 'N/A') return false;
      const numCount = count.includes('K') ? 
        parseFloat(count.replace('K', '')) * 1000 :
        count.includes('M') ? 
          parseFloat(count.replace('M', '')) * 1000000 :
          parseInt(count.replace(/[^0-9]/g, ''));
      if (isNaN(numCount) || numCount === 0) return false;
    } else if (typeof count === 'number') {
      if (count === 0 || isNaN(count)) return false;
    }
  }

  return true;
}

export function normalizeRating(
  rating: string | number | undefined,
  platform: string,
  type: string = 'default'
): number | null {
  if (!rating || rating === '暂无' || rating === 'tbd' || rating === '0') {
    return null;
  }

  const numericRating = typeof rating === 'string' ? parseFloat(rating) : rating;
  
  switch (platform) {
    case 'douban':
      return numericRating;
      
    case 'imdb':
      return numericRating;
      
    case 'rottentomatoes':
      if (type === 'percentage') {
        return numericRating / 10;
      } else if (type === 'audience_avg') {
        return numericRating * 2;
      } else {
        return numericRating;
      }
      
    case 'metacritic':
      if (type === 'metascore') {
        return numericRating / 10;
      } else if (type === 'userscore') {
        return numericRating;
      } else {
        return numericRating / 10;
      }
      
    case 'tmdb':
      return numericRating;
      
    case 'trakt':
      return numericRating;
      
    case 'letterboxd':
      if (type === 'percentage') {
        return numericRating / 10;
      } else {
        return numericRating * 2;
      }
      
    default:
      return numericRating;
  }
}

export function calculateMedianVoteCount(
  ratingData: any, 
  options: { 
    includeSeasons?: boolean,
    checkOtherSeasons?: boolean
  } = {}
): number {
  const { includeSeasons = false, checkOtherSeasons = false } = options;
  const voteCounts: number[] = [];

  if (ratingData.douban?.rating_people) {
    const count = parseFloat(ratingData.douban.rating_people.replace(/[^0-9]/g, ''));
    if (!isNaN(count) && count > 0) {
      voteCounts.push(count);
    }
  }
  
  if (ratingData.imdb?.rating_people) {
    const count = parseFloat(ratingData.imdb.rating_people.replace(/[^0-9]/g, ''));
    if (!isNaN(count) && count > 0) {
      voteCounts.push(count);
    }
  }
  
  if (ratingData.rottentomatoes?.series?.critics_count) {
    const count = parseFloat(ratingData.rottentomatoes.series.critics_count.replace(/[^0-9]/g, ''));
    if (!isNaN(count) && count > 0) voteCounts.push(count);
  } else if (ratingData.rottentomatoes?.critics_count) {
    const count = parseFloat(ratingData.rottentomatoes.critics_count.replace(/[^0-9]/g, ''));
    if (!isNaN(count) && count > 0) voteCounts.push(count);
  }
  
  if (ratingData.rottentomatoes?.series?.audience_count) {
    const count = parseFloat(ratingData.rottentomatoes.series.audience_count.replace(/[^0-9]/g, ''));
    if (!isNaN(count) && count > 0) voteCounts.push(count);
  } else if (ratingData.rottentomatoes?.audience_count) {
    const count = parseFloat(ratingData.rottentomatoes.audience_count.replace(/[^0-9]/g, ''));
    if (!isNaN(count) && count > 0) voteCounts.push(count);
  }
  
  if (ratingData.metacritic?.overall?.critics_count) {
    const count = parseFloat(ratingData.metacritic.overall.critics_count);
    if (!isNaN(count) && count > 0) voteCounts.push(count);
  } else if (ratingData.metacritic?.critics_count) {
    const count = parseFloat(ratingData.metacritic.critics_count);
    if (!isNaN(count) && count > 0) voteCounts.push(count);
  }
  
  if (ratingData.metacritic?.overall?.users_count) {
    const count = parseFloat(ratingData.metacritic.overall.users_count);
    if (!isNaN(count) && count > 0) voteCounts.push(count);
  } else if (ratingData.metacritic?.users_count) {
    const count = parseFloat(ratingData.metacritic.users_count);
    if (!isNaN(count) && count > 0) voteCounts.push(count);
  }
  
  if (ratingData.tmdb?.voteCount) {
    const count = ratingData.tmdb.voteCount;
    if (!isNaN(count) && count > 0) {
      voteCounts.push(count);
    }
  }
  
  if (ratingData.trakt?.votes) {
    const count = parseInt(ratingData.trakt.votes);
    if (!isNaN(count) && count > 0) {
      voteCounts.push(count);
    }
  }
  
  if (ratingData.letterboxd?.rating_count) {
    const count = parseFloat(ratingData.letterboxd.rating_count.replace(/[^0-9]/g, ''));
    if (!isNaN(count) && count > 0) {
      voteCounts.push(count);
    }
  }

  if (includeSeasons && ('type' in ratingData && ratingData.type === 'tv' || ratingData.seasons)) {
    const tvData = ratingData;
    tvData.seasons?.forEach((season: {
      douban?: Partial<DoubanSeasonRating>;
      rottentomatoes?: Partial<RottenTomatoesSeasonRating>;
      metacritic?: Partial<MetacriticSeasonRating>;
      tmdb?: Partial<TMDBSeasonRating>;
      trakt?: Partial<TraktSeasonRating>;
    }) => {
      if (season.douban?.rating_people) {
        const count = parseFloat(season.douban.rating_people.replace(/[^0-9]/g, ''));
        if (!isNaN(count) && count > 0) voteCounts.push(count);
      }
      if (season.rottentomatoes?.critics_count) {
        const count = parseFloat(season.rottentomatoes.critics_count.replace(/[^0-9]/g, ''));
        if (!isNaN(count) && count > 0) voteCounts.push(count);
      }
      if (season.rottentomatoes?.audience_count) {
        const count = parseFloat(season.rottentomatoes.audience_count.replace(/[^0-9]/g, ''));
        if (!isNaN(count) && count > 0) voteCounts.push(count);
      }
      if (season.metacritic?.critics_count) {
        const count = parseFloat(season.metacritic.critics_count);
        if (!isNaN(count) && count > 0) voteCounts.push(count);
      }
      if (season.metacritic?.users_count) {
        const count = parseFloat(season.metacritic.users_count);
        if (!isNaN(count) && count > 0) voteCounts.push(count);
      }
      if (season.tmdb?.voteCount) {
        const count = season.tmdb.voteCount;
        if (!isNaN(count) && count > 0) voteCounts.push(count);
      }
      if (season.trakt?.votes) {
        const count = typeof season.trakt.votes === 'number' ? season.trakt.votes : parseInt(season.trakt.votes);
        if (!isNaN(count) && count > 0) voteCounts.push(count);
      }
    });
  }

  if (voteCounts.length === 0 && checkOtherSeasons) {
    const allSeasonVoteCounts: number[] = [];
    
    ratingData.douban?.seasons?.forEach((season: { rating_people: string }) => {
      if (season.rating_people) {
        allSeasonVoteCounts.push(parseFloat(season.rating_people.replace(/[^0-9]/g, '')));
      }
    });
    ratingData.rottentomatoes?.seasons?.forEach((season: { critics_count?: string; audience_count?: string }) => {
      if (season.critics_count) {
        allSeasonVoteCounts.push(parseFloat(season.critics_count.replace(/[^0-9]/g, '')));
      }
      if (season.audience_count) {
        allSeasonVoteCounts.push(parseFloat(season.audience_count.replace(/[^0-9]/g, '')));
      }
    });

    ratingData.metacritic?.seasons?.forEach((season: Partial<MetacriticSeasonRating>) => {
      if (season.critics_count) {
        allSeasonVoteCounts.push(parseFloat(season.critics_count));
      }
      if (season.users_count) {
        allSeasonVoteCounts.push(parseFloat(season.users_count));
      }
    });

    ratingData.trakt?.seasons?.forEach((season: Partial<TraktSeasonRating>) => {
      if (season.votes) {
        allSeasonVoteCounts.push(season.votes);
      }
    });

    if (allSeasonVoteCounts.length > 0) {
      allSeasonVoteCounts.sort((a, b) => a - b);
      const mid = Math.floor(allSeasonVoteCounts.length / 2);
      return allSeasonVoteCounts.length % 2 === 0 
        ? (allSeasonVoteCounts[mid - 1] + allSeasonVoteCounts[mid]) / 2
        : allSeasonVoteCounts[mid];
    }
  }

  if (voteCounts.length === 0) {
    return 1000;
  }
  
  voteCounts.sort((a, b) => a - b);
  const mid = Math.floor(voteCounts.length / 2);
  return voteCounts.length % 2 === 0 
    ? (voteCounts[mid - 1] + voteCounts[mid]) / 2
    : voteCounts[mid];
}

export function aggregateDoubanSeasonRatings(
  seasons: Array<Pick<DoubanSeasonRating, 'rating' | 'rating_people'>>
): { rating: string; rating_people: string } | null {
  if (!seasons || seasons.length === 0) {
    return null;
  }

  const parsed = seasons
    .map((s) => {
      const rating = parseFloat(String(s.rating ?? '').trim());
      const count = parseFloat(String(s.rating_people ?? '').replace(/[^0-9]/g, ''));
      if (!rating || isNaN(rating) || rating <= 0 || !count || isNaN(count) || count <= 0) {
        return null;
      }
      return { rating, count };
    })
    .filter((x): x is { rating: number; count: number } => x !== null);

  if (parsed.length === 0) {
    return null;
  }

  const totalVotes = parsed.reduce((sum, item) => sum + item.count, 0);
  if (totalVotes <= 0) {
    return null;
  }

  const averageScore = parsed.reduce((sum, item) => sum + item.rating, 0) / parsed.length;

  return {
    rating: averageScore.toFixed(1),
    rating_people: String(Math.round(totalVotes)),
  };
}
