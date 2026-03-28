// ==========================================
// 剧集头图信息组件
// ==========================================
import type { ReactNode } from 'react';
import { MediaHero } from './MediaHero';
import type { TVShow } from '../../shared/types/media';
import type { TVShowRatingData } from '../../modules/rating/ratings';

interface TVShowHeroProps {
  tvShow: TVShow;
  backdropUrl?: string;
  ratingData?: TVShowRatingData;
  posterBelow?: ReactNode;
  rightPanel?: ReactNode;
  bottomRight?: ReactNode;
  titleRight?: ReactNode;
  isAllDataFetched?: boolean;
}

export function TVShowHero({
  tvShow,
  backdropUrl,
  posterBelow,
  rightPanel,
  bottomRight,
  titleRight
}: TVShowHeroProps) {
  return (
    <MediaHero
      media={tvShow}
      backdropUrl={backdropUrl}
      posterBelow={posterBelow}
      rightPanel={rightPanel}
      bottomRight={bottomRight}
      titleRight={titleRight}
    />
  );
} 
