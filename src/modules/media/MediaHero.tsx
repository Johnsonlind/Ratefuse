// ==========================================
// 媒体详情头图区组件
// ==========================================
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Movie, TVShow } from '../../shared/types/media';
import { OverviewModal } from '../../shared/ui/OverviewModal';

interface MediaHeroProps {
  media: Movie | TVShow;
  backdropUrl?: string;
  posterBelow?: ReactNode;
  rightPanel?: ReactNode;
  bottomRight?: ReactNode;
  titleRight?: ReactNode;
}

export function MediaHero({ media, backdropUrl, posterBelow, rightPanel, bottomRight, titleRight }: MediaHeroProps) {
  const [showOverview, setShowOverview] = useState(false);

  return (
    <>
      <div className="relative min-h-[45vh] sm:min-h-[60vh] w-screen left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] overflow-hidden">
        {/* 背景图片 */}
        <div 
          className="absolute -top-16 inset-x-0 bottom-0 h-[calc(100%+4rem)] bg-cover bg-center bg-no-repeat blur-sm"
          style={{ 
            backgroundImage: `url(${backdropUrl || media.poster})`,
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          {/* 渐隐过渡 */}
          <div
            className="absolute inset-x-0 bottom-0 h-40 pointer-events-none"
            style={{
              backgroundImage: 'linear-gradient(to bottom, transparent 0%, transparent 30%, color-mix(in srgb, var(--system-bg) 30%, transparent) 60%, var(--system-bg) 100%)',
            }}
          />
        </div>

        {/* 内容 */}
        <div className="mx-auto max-w-7xl px-4 pt-20 pb-4 sm:pt-24 sm:pb-8 relative">
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            {/* 左侧：海报列 + 文本列 */}
            <div className="flex-1 min-w-0 flex flex-col sm:flex-row gap-4 sm:gap-6 items-start relative z-10">
              {/* 海报列 */}
              <div className="w-32 sm:w-44 lg:w-56 mx-auto sm:mx-0 flex-shrink-0">
                <div className="w-full">
                  <img
                    src={media.poster}
                    alt={media.title}
                    className="w-full rounded-lg shadow-xl border border-white/10"
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                  />
                </div>
              </div>

              {/* 文本列 */}
              <div className="flex-1 text-center sm:text-left flex flex-col min-w-0 w-full">
                <div className="flex items-center justify-center sm:justify-between gap-3 mb-2 w-full">
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white drop-shadow-lg">
                    {media.title} <span className="text-gray-200">({media.year})</span>
                  </h1>
                  {titleRight && (
                    <div className="hidden sm:block">
                      {titleRight}
                    </div>
                  )}
                </div>

                {/* 标题下方 */}
                {posterBelow && (
                  <div className="mb-3 flex justify-start">
                    {posterBelow}
                  </div>
                )}

                {/* MovieMetadata */}
                {bottomRight && (
                  <div className="mb-3 flex justify-start">
                    {bottomRight}
                  </div>
                )}

                {/* 移动端概览 */}
                <div className="sm:hidden">
                  <p className="text-sm text-gray-200 leading-relaxed line-clamp-3">
                    {media.overview}
                  </p>
                  <button
                    onClick={() => setShowOverview(true)}
                    className="mt-2 text-blue-400 flex items-center gap-1 mx-auto"
                  >
                    查看更多 <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                {/* 桌面概览 */}
                <p className="hidden sm:block text-base lg:text-lg text-gray-200 leading-relaxed">
                  {media.overview}
                </p>
              </div>
            </div>

            {/* 右侧：评分区域 */}
            {rightPanel && (
              <div className="flex-1 min-w-0 w-full max-w-xl relative z-10">
                {rightPanel}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 概览模态框 */}
      <OverviewModal
        isOpen={showOverview}
        onClose={() => setShowOverview(false)}
        overview={media.overview}
        title={media.title}
      />
    </>
  );
}
