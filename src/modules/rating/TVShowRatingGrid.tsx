// ==========================================
// 剧集评分网格组件
// ==========================================
import { RatingCard, RottenTomatoesCard, MetacriticCard } from './RatingCard';
import type { DoubanRating, TVShowRatingData } from '../../modules/rating/ratings';
import { formatRating } from '../../modules/rating/formatRating';
import ErrorMessage from '../../shared/ui/ErrorMessage';
import type { FetchStatus } from '../../shared/types/status';
import { calculateSeasonRating } from './calculateSeasonRating';
import { OverallRatingCard } from './OverallRatingCard';
import { calculateTVShowOverallRating } from './calculateTVShowOverallRating';
import { isValidRatingData } from '../../modules/rating/ratingHelpers';
import { 
  getDoubanUrl, 
  getImdbUrl, 
  getLetterboxdUrl, 
  getRottenTomatoesUrl, 
  getMetacriticUrl, 
  getTmdbUrl, 
  getTraktUrl 
} from '../../shared/utils/platformUrls';
import type { TVShow } from '../../shared/types/media';

interface TVShowRatingGridProps {
  ratingData: TVShowRatingData;
  selectedSeason?: number;
  className?: string;
  isLoading?: boolean;
  error?: {
    status: FetchStatus;
    detail: string;
  };
  onRetry: () => void;
  tvShow?: TVShow;
  cardSize?: 'default' | 'compact';
  columns?: 'two' | 'three';
}

function aggregateDoubanSeasons(douban?: DoubanRating): DoubanRating | undefined {
  if (!douban) return undefined;
  const seasons = Array.isArray(douban.seasons) ? douban.seasons : [];
  if (seasons.length === 0) return douban;

  const ratings: number[] = [];
  let peopleSum = 0;

  for (const s of seasons) {
    const r = Number(s.rating);
    const p = Number(s.rating_people);
    if (Number.isFinite(r) && r > 0) ratings.push(r);
    if (Number.isFinite(p) && p > 0) peopleSum += p;
  }

  if (ratings.length === 0) return douban;

  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  return {
    ...douban,
    rating: avg.toFixed(1),
    rating_people: String(peopleSum),
  };
}

export function TVShowRatingGrid({ 
  ratingData, 
  selectedSeason, 
  className = '',
  isLoading,
  error,
  onRetry,
  tvShow,
  cardSize = 'default',
  columns = 'three'
}: TVShowRatingGridProps) {
  const mediaInfo = tvShow ? {
    id: tvShow.id,
    imdbId: tvShow.imdbId,
    title: tvShow.title,
    originalTitle: tvShow.originalTitle,
    enTitle: tvShow.enTitle,
    year: tvShow.year,
    type: 'tv' as const
  } : undefined;

  const urls = (() => {
    if (selectedSeason && ratingData) {
      const doubanSeasonData = ratingData.douban?.seasons?.find(s => s.season_number === selectedSeason);
      const doubanUrl = doubanSeasonData?.url || ratingData?.douban?.url || (mediaInfo ? getDoubanUrl(mediaInfo) : null);
      const rtSeasonData = ratingData.rottentomatoes?.seasons?.find(s => s.season_number === selectedSeason);
      const rtUrl = rtSeasonData?.url || ratingData?.rottentomatoes?.url || (mediaInfo ? getRottenTomatoesUrl(mediaInfo) : null);
      const mcSeasonData = ratingData.metacritic?.seasons?.find(s => s.season_number === selectedSeason);
      const mcUrl = mcSeasonData?.url || ratingData?.metacritic?.url || (mediaInfo ? getMetacriticUrl(mediaInfo) : null);
      const tmdbUrl = mediaInfo ? `https://www.themoviedb.org/tv/${mediaInfo.id}/season/${selectedSeason}` : null;
      
      let traktUrl = ratingData?.trakt?.url || (mediaInfo ? getTraktUrl(mediaInfo) : null);
      if (traktUrl && selectedSeason) {
        if (!traktUrl.includes('/search')) {
          traktUrl = `${traktUrl}/seasons/${selectedSeason}`;
        }
      }
      
      return {
        douban: doubanUrl,
        imdb: ratingData?.imdb?.url || (mediaInfo ? getImdbUrl(mediaInfo) : null),
        letterboxd: ratingData?.letterboxd?.url || (mediaInfo ? getLetterboxdUrl(mediaInfo) : null),
        rottentomatoes: rtUrl,
        metacritic: mcUrl,
        tmdb: tmdbUrl,
        trakt: traktUrl
      };
    }
    
    return {
      douban: ratingData?.douban?.url || (mediaInfo ? getDoubanUrl(mediaInfo) : null),
      imdb: ratingData?.imdb?.url || (mediaInfo ? getImdbUrl(mediaInfo) : null),
      letterboxd: ratingData?.letterboxd?.url || (mediaInfo ? getLetterboxdUrl(mediaInfo) : null),
      rottentomatoes: ratingData?.rottentomatoes?.url || (mediaInfo ? getRottenTomatoesUrl(mediaInfo) : null),
      metacritic: ratingData?.metacritic?.url || (mediaInfo ? getMetacriticUrl(mediaInfo) : null),
      tmdb: mediaInfo ? getTmdbUrl(mediaInfo) : null,
      trakt: ratingData?.trakt?.url || (mediaInfo ? getTraktUrl(mediaInfo) : null)
    };
  })();

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-center p-8 ${className}`}>
        <ErrorMessage
          status={error.status}
          errorDetail={error.detail}
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (!ratingData) {
    return (
      <div className={`text-center p-8 ${className}`}>
        <p className="text-gray-500">暂无评分数据</p>
      </div>
    );
  }

  const getSeasonRatings = () => {
    if (selectedSeason) {
      const doubanSeason = ratingData?.douban?.seasons?.find(s => 
        s.season_number === selectedSeason
      );
      const doubanForSeason = doubanSeason || (selectedSeason === 1 && ratingData?.douban?.rating ? {
        season_number: 1,
        rating: ratingData.douban.rating,
        rating_people: ratingData.douban.rating_people
      } : undefined);

      const tmdbSeasonRating = ratingData?.tmdb?.seasons?.find(s => 
        s.season_number === selectedSeason
      );
      
      const traktSeasonRating = ratingData?.trakt?.seasons?.find(s => 
        s.season_number === selectedSeason
      );

      return {
        type: 'tv' as const,
        douban: doubanForSeason,
        imdb: null,
        rt: ratingData?.rottentomatoes?.seasons?.find(s => s.season_number === selectedSeason),
        metacritic: ratingData?.metacritic?.seasons?.find(s => s.season_number === selectedSeason),
        tmdb: tmdbSeasonRating ? {
          rating: tmdbSeasonRating.rating,
          voteCount: tmdbSeasonRating.voteCount
        } : null,
        trakt: traktSeasonRating ? {
          rating: traktSeasonRating.rating,
          votes: traktSeasonRating.votes || 0,
          distribution: traktSeasonRating.distribution,
          seasons: ratingData?.trakt?.seasons
        } : null
      };
    }

    return {
      type: 'tv' as const,
      douban: aggregateDoubanSeasons(ratingData?.douban),
      imdb: ratingData?.imdb,
      rt: ratingData?.rottentomatoes?.series,
      metacritic: ratingData?.metacritic?.overall,
      tmdb: ratingData?.tmdb,
      trakt: ratingData?.trakt,
      seasons: [
        ...(ratingData?.douban?.seasons || []),
        ...(ratingData?.rottentomatoes?.seasons || []),
        ...(ratingData?.metacritic?.seasons || []),
        ...(ratingData?.tmdb?.seasons || []),
        ...(ratingData?.trakt?.seasons || [])
      ]
    };
  };

  const ratings = getSeasonRatings();

  const renderTMDBRating = () => {
    if (!ratings.tmdb?.rating) return null;
    return (
      <RatingCard
        logo={`/logos/tmdb.png`}
        rating={Number(formatRating.tmdb(ratings.tmdb.rating))}
        maxRating={10}
        label={selectedSeason ? undefined : ratings.tmdb.voteCount ? `${formatRating.count(ratings.tmdb.voteCount)} 人评分` : undefined}
        showStars={true}
        url={urls.tmdb}
        size={cardSize}
      />
    );
  };

  const renderTraktRating = () => {
    if (selectedSeason) {
      const seasonRating = ratings.trakt?.seasons?.find(s => 
        s.season_number === selectedSeason
      );

      if (seasonRating?.rating && seasonRating.rating > 0) {
        return (
          <RatingCard
            logo={`/logos/trakt.png`}
            rating={Number((seasonRating.rating).toFixed(1))}
            maxRating={10}
            label={seasonRating.votes ? `${formatRating.count(seasonRating.votes)} 人评分` : undefined}
            showStars
            url={urls.trakt}
            size={cardSize}
          />
        );
      }
    } else if (ratings.trakt?.rating && ratings.trakt.rating > 0) {
      return (
        <RatingCard
          logo={`/logos/trakt.png`}
          rating={Number((ratings.trakt.rating).toFixed(1))}
          maxRating={10}
          label={ratings.trakt.votes ? `${formatRating.count(ratings.trakt.votes)} 人评分` : undefined}
          showStars
          url={urls.trakt}
          size={cardSize}
        />
      );
    }
    return null;
  };

  const overallRating = calculateTVShowOverallRating(ratingData);
  const seasonRating = selectedSeason ? calculateSeasonRating(ratingData, selectedSeason) : null;

  const gridCols =
    columns === 'two'
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-2'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="space-y-4">
      {!selectedSeason && (
        <div className="mb-6">
          <OverallRatingCard 
            rating={overallRating.rating || 0} 
            validPlatformsCount={overallRating.validRatings}
          />
        </div>
      )}
      {selectedSeason && seasonRating && (
        <div className="mb-6">
          <OverallRatingCard 
            rating={seasonRating.rating || 0}
            validPlatformsCount={seasonRating.validRatings}
          />
        </div>
      )}
      {/* 评分卡片 */}
      <div className={`grid ${gridCols} gap-4 ${className}`}>
        {/* 豆瓣评分 */}
        {ratings.douban &&
         ratings.douban.rating &&
         ratings.douban.rating !== '暂无' &&
         Number(ratings.douban.rating) > 0 && (
          !selectedSeason && ratingData.douban?.seasons && ratingData.douban.seasons.length > 1 ? (
            <div className="relative">
              <RatingCard
                logo={`/logos/douban.png`}
                rating={Number(ratings.douban.rating)}
                maxRating={10}
                label={`${formatRating.count(ratings.douban.rating_people)} 人评分`}
                showStars
                url={urls.douban}
                size={cardSize}
              />
              <div className="pointer-events-none absolute right-3 bottom-2 text-[8px] text-gray-300">
                *各季均分与总人数
              </div>
            </div>
          ) : (
            <RatingCard
              logo={`/logos/douban.png`}
              rating={Number(ratings.douban.rating)}
              maxRating={10}
              label={`${formatRating.count(ratings.douban.rating_people)} 人评分`}
              showStars
              url={urls.douban}
              size={cardSize}
            />
          )
        )}
        {/* IMDb 评分 */}
        {ratings.imdb && ratings.imdb.rating && ratings.imdb.rating !== '暂无' && Number(ratings.imdb.rating) > 0 && (
          <RatingCard
            logo={`/logos/imdb.png`}
            rating={Number(ratings.imdb.rating)}
            maxRating={10}
            label={`${formatRating.count(ratings.imdb.rating_people)} 人评分`}
            showStars
            url={urls.imdb}
            size={cardSize}
          />
        )}
        {/* Rotten Tomatoes 评分 */}
        {ratings.rt && (isValidRatingData(ratings.rt.tomatometer) || isValidRatingData(ratings.rt.audience_score)) && (
          <RottenTomatoesCard
            criticScore={ratings.rt.tomatometer !== '暂无' && 
              ratings.rt.tomatometer !== '0' && 
              ratings.rt.tomatometer !== 'tbd' ? 
              formatRating.percentage(ratings.rt.tomatometer) : undefined}
            audienceScore={ratings.rt.audience_score !== '暂无' && 
              ratings.rt.audience_score !== '0' && 
              ratings.rt.audience_score !== 'tbd' ? 
              formatRating.percentage(ratings.rt.audience_score) : undefined}
            criticReviews={ratings.rt.critics_count !== '暂无' ? 
              formatRating.count(ratings.rt.critics_count) : undefined}
            audienceReviews={ratings.rt.audience_count !== '暂无' ? 
              formatRating.count(ratings.rt.audience_count) : undefined}
            criticAvg={ratings.rt.critics_avg !== '暂无' ? ratings.rt.critics_avg : undefined}
            audienceAvg={ratings.rt.audience_avg !== '暂无' ? ratings.rt.audience_avg : undefined}
            url={urls.rottentomatoes}
            size={cardSize}
          />
        )}
        {/* Metacritic 评分 */}
        {ratings.metacritic && (
          (ratings.metacritic.metascore !== '暂无' && 
           ratings.metacritic.metascore !== 'tbd' && 
           Number(ratings.metacritic.metascore) > 0) || 
          (ratings.metacritic.userscore !== '暂无' && 
           ratings.metacritic.userscore !== 'tbd' && 
           Number(ratings.metacritic.userscore) > 0)
        ) && (
          <MetacriticCard
            metascore={ratings.metacritic.metascore !== '暂无' && 
              ratings.metacritic.metascore !== 'tbd' ? 
              Number(formatRating.number(ratings.metacritic.metascore)) : 0}
            userScore={ratings.metacritic.userscore !== '暂无' && 
              ratings.metacritic.userscore !== 'tbd' ? 
              Number(formatRating.number(ratings.metacritic.userscore)) : 0}
            criticReviews={ratings.metacritic.critics_count !== '暂无' ? 
              formatRating.count(ratings.metacritic.critics_count) : undefined}
            userReviews={ratings.metacritic.users_count !== '暂无' ? 
              formatRating.count(ratings.metacritic.users_count) : undefined}
            url={urls.metacritic}
            size={cardSize}
          />
        )}
        {/* Letterboxd 评分 */}
        {!selectedSeason && 
         ratingData.letterboxd?.rating && 
         ratingData.letterboxd.rating !== '暂无' && 
         Number(ratingData.letterboxd.rating) > 0 && (
            <RatingCard
              logo={`/logos/letterboxd.png`}
              rating={formatRating.letterboxd(Number(ratingData.letterboxd.rating))}
              maxRating={10}
              label={`${formatRating.count(ratingData.letterboxd.rating_count)} 人评分`}
              showStars
              url={urls.letterboxd}
              size={cardSize}
            />
          )}
        {/* TMDB 评分 */}
        {renderTMDBRating()}
        {/* Trakt 评分 */}
        {renderTraktRating()}
      </div>
    </div>
  );
}
