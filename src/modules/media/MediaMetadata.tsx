// ==========================================
// 媒体元数据展示组件
// ==========================================
import { Clock, Calendar, Tag, PlayCircle } from 'lucide-react';
import { formatRuntime, formatDate } from '../../shared/utils/utils';
import { cn } from '../../shared/utils/utils';

interface MovieMetadataProps {
  rating?: string;
  releaseDate: string;
  runtime?: number;
  genres?: string[];
  useContainer?: boolean;
  className?: string;
}

export function MovieMetadata({
  rating,
  releaseDate,
  runtime,
  genres,
  useContainer = true,
  className
}: MovieMetadataProps) {
  const content = (
    <div className={cn("glass-card glass-exempt rounded-full px-4 py-2 sm:px-5 sm:py-2", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-white">
        {rating && (
          <div className="flex items-center gap-2">
            <Tag className="w-3 h-3 sm:w-4 sm:h-4 text-white/80" />
            <span>{rating}</span>
          </div>
        )}
        
        <div className="flex items-center gap-2">
          <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-white/80" />
          <span>{releaseDate}</span>
        </div>
        
        {runtime && (
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3 sm:w-4 sm:h-4 text-white/80" />
            <span>{formatRuntime(runtime)}</span>
          </div>
        )}

        {genres && genres.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
            {genres.map(genre => (
              <span 
                key={genre}
                className="bg-white/10 text-white px-2 py-0.5 rounded-full text-[10px] sm:text-xs"
              >
                {genre}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    useContainer ? (
      <div className="container mx-auto px-4 py-4 sm:py-6">
        {content}
      </div>
    ) : content
  );
}

interface TVShowMetadataProps {
  status: string;
  firstAirDate: string;
  lastAirDate: string;
  episodeCount: number;
  seasonCount: number;
  genres: string[];
  useContainer?: boolean;
  className?: string;
}

export function TVShowMetadata({ 
  status, 
  firstAirDate, 
  lastAirDate, 
  episodeCount,
  seasonCount,
  genres,
  useContainer = true,
  className
}: TVShowMetadataProps) {
  const content = (
    <div className={cn("glass-card glass-exempt rounded-full px-4 py-2 sm:px-5 sm:py-2", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-white">
        {status && (
          <div className="flex items-center gap-2">
            <Tag className="w-3 h-3 sm:w-4 sm:h-4 text-white/80" />
            <span>
              {status === 'Ended' ? '已完结' : '连载中'}
            </span>
          </div>
        )}
        
        {firstAirDate && (
          <div className="flex items-center gap-2">
            <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-white/80" />
            <span>
              {formatDate(firstAirDate)}
              {status === 'Ended' && lastAirDate && ` - ${formatDate(lastAirDate)}`}
            </span>
          </div>
        )}
        
        <div className="flex items-center gap-2">
          <PlayCircle className="w-3 h-3 sm:w-4 sm:h-4 text-white/80" />
          <span>
            {seasonCount} 季 {episodeCount} 集
          </span>
        </div>
        
        {genres && genres.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
            {genres.map(genre => (
              <span 
                key={genre}
                className="bg-white/10 text-white px-2 py-0.5 rounded-full text-[10px] sm:text-xs"
              >
                {genre}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    useContainer ? (
      <div className="container mx-auto px-4 py-4 sm:py-6">
        {content}
      </div>
    ) : content
  );
}
