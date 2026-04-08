// ==========================================
// 电影头图信息组件
// ==========================================
import { MediaHero } from './MediaHero';
import type { ReactNode } from 'react';
import type { Movie } from '../../shared/types/media';
import type { MovieRatingData } from '../../modules/rating/ratings';

interface MovieHeroProps {
  movie: Movie;
  backdropUrl: string;
  ratingData?: MovieRatingData;
  posterBelow?: ReactNode;
  rightPanel?: ReactNode;
  bottomRight?: ReactNode;
  titleRight?: ReactNode;
}

export function MovieHero({ movie, backdropUrl, posterBelow, rightPanel, bottomRight, titleRight }: MovieHeroProps) {
  return (
    <MediaHero
      media={movie}
      backdropUrl={backdropUrl}
      posterBelow={posterBelow}
      rightPanel={rightPanel}
      bottomRight={bottomRight}
      titleRight={titleRight}
    />
  );
}
