// ==========================================
// 详情页骨架屏组件
// ==========================================
interface MediaPageSkeletonProps {
  variant?: 'movie' | 'tv';
}

export function MediaPageSkeleton({ variant = 'movie' }: MediaPageSkeletonProps) {
  return (
    <>
      {/* Hero 骨架屏 */}
      <div className="relative min-h-[45vh] sm:min-h-[60vh] bg-gray-200 dark:bg-gray-800 animate-pulse">
        <div className="container mx-auto px-4 py-4 sm:py-8 relative">
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 items-start">
            {/* 海报骨架 */}
            <div className="w-32 sm:w-48 lg:w-64 mx-auto sm:mx-0 flex-shrink-0">
              <div className="w-full aspect-[2/3] bg-gray-300 dark:bg-gray-700 rounded-lg" />
            </div>

            {/* 标题 + 元数据 + 简介骨架 */}
            <div className="flex-1 min-w-0 flex flex-col space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-2/3" />
                <div className="h-10 w-28 bg-gray-300 dark:bg-gray-700 rounded-xl hidden sm:block" />
              </div>

              <div className="h-7 bg-gray-300 dark:bg-gray-700 rounded-full w-full" />

              <div className="space-y-2">
                <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-full" />
                <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-5/6" />
                <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-3/4 hidden sm:block" />
              </div>
            </div>

            {/* 右侧评分面板骨架 */}
            <div className="flex-1 min-w-0 w-full max-w-xl hidden sm:block">
              <div className="glass-card rounded-lg p-4 sm:p-5 bg-gray-900/40">
                <div className="space-y-5">
                  {/* 数据来源标题 + 标签 */}
                  <div>
                    <div className="h-4 w-20 bg-gray-300/80 dark:bg-gray-700 rounded" />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[1, 2, 3].map(i => (
                        <div
                          key={i}
                          className="h-6 w-20 bg-gray-300/70 dark:bg-gray-700 rounded-full"
                        />
                      ))}
                    </div>
                  </div>

                  {/* 剧集/电影评分标题 + 网格 */}
                  <div className="space-y-3">
                    <div className="h-5 w-24 bg-gray-300/80 dark:bg-gray-700 rounded" />
                    <div className="grid grid-cols-2 gap-3">
                      {[1, 2, 3, 4].map(i => (
                        <div
                          key={i}
                          className="h-16 bg-gray-300/70 dark:bg-gray-700 rounded-lg"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 下方内容骨架：演员/剧组 +（TV 专用）季度评分 */}
      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* 演员 / 主创列表骨架 */}
        <div>
          <div className="h-6 w-28 bg-gray-300 dark:bg-gray-700 rounded mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="space-y-2">
                <div className="h-32 bg-gray-300 dark:bg-gray-700 rounded-lg" />
                <div className="h-3 w-3/4 bg-gray-300 dark:bg-gray-700 rounded" />
                <div className="h-3 w-1/2 bg-gray-300 dark:bg-gray-700 rounded" />
              </div>
            ))}
          </div>
        </div>

        {/* 剧集季度评分骨架 */}
        {variant === 'tv' && (
          <div>
            <div className="h-6 w-28 bg-gray-300 dark:bg-gray-700 rounded mb-4" />
            <div className="space-y-4">
              {[1, 2].map(season => (
                <div key={season} className="glass rounded-lg p-4 dark:bg-gray-900/40">
                  <div className="h-4 w-32 bg-gray-300 dark:bg-gray-700 rounded mb-3" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {[1, 2, 3].map(i => (
                      <div
                        key={i}
                        className="h-16 bg-gray-300 dark:bg-gray-700 rounded-lg"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
