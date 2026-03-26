// ==========================================
// 电影评分导出卡片组件
// ==========================================
import { formatRating } from '../../modules/rating/formatRating';
import type { RatingData } from '../../modules/rating/ratings';
import { calculateOverallRating } from '../../modules/rating/calculateOverallRating';
import { isValidRatingData } from '../../modules/rating/ratingHelpers';
import { getExportStyles } from './exportStyles';
import { createExportRenderers } from './exportRenderers';

interface ExportRatingCardProps {
  media: {
    title: string;
    year: string;
    poster: string;
  };
  ratingData: RatingData;
  selectedSeason?: number;
  layout?: 'portrait' | 'landscape';
}

export function ExportRatingCard({ media, ratingData, selectedSeason, layout = 'portrait' }: ExportRatingCardProps) {
  if (!media || !ratingData) {
    return null;
  }

  const isDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  
  const { rating: overallRating, validRatings: validPlatformsCount } = calculateOverallRating(ratingData);

  const styles = getExportStyles(isDark);
  const { renderRatingCard, renderRottenTomatoesCard, renderMetacriticCard } = createExportRenderers({
    ratingCardStyle: styles.ratingCardStyle
  });

  const ratingCards = [];

  if (ratingData.douban && isValidRatingData(ratingData.douban.rating)) {
    ratingCards.push(
      <div key="douban" style={{ width: '100%' }}>
        {renderRatingCard(
          `/logos/douban.png`,
          Number(ratingData.douban.rating),
          `${formatRating.count(ratingData.douban.rating_people)} 人评分`,
          true
        )}
      </div>
    );
  }

  if (ratingData.imdb && isValidRatingData(ratingData.imdb.rating)) {
    ratingCards.push(
      <div key="imdb" style={{ width: '100%' }}>
        {renderRatingCard(
          `/logos/imdb.png`,
          Number(ratingData.imdb.rating),
          `${formatRating.count(ratingData.imdb.rating_people)} 人评分`,
          true
        )}
      </div>
    );
  }

  if (ratingData.rottentomatoes?.series && isValidRatingData(ratingData.rottentomatoes.series.tomatometer)) {
    const rtData = ratingData.rottentomatoes.series;
    ratingCards.push(
      <div key="rottentomatoes" style={{ width: '100%' }}>
        {renderRottenTomatoesCard(
          formatRating.percentage(rtData.tomatometer),
          formatRating.percentage(rtData.audience_score),
          formatRating.count(rtData.critics_count),
          formatRating.count(rtData.audience_count),
          rtData.critics_avg !== '暂无' ? rtData.critics_avg : undefined,
          rtData.audience_avg !== '暂无' ? rtData.audience_avg : undefined
        )}
      </div>
    );
  }

  if (ratingData.metacritic?.overall && isValidRatingData(ratingData.metacritic.overall.metascore)) {
    const mcData = ratingData.metacritic.overall;
    ratingCards.push(
      <div key="metacritic" style={{ width: '100%' }}>
        {renderMetacriticCard(
          formatRating.number(mcData.metascore),
          formatRating.number(mcData.userscore),
          formatRating.count(mcData.critics_count),
          formatRating.count(mcData.users_count)
        )}
      </div>
    );
  }

  if (!selectedSeason && ratingData.letterboxd && isValidRatingData(ratingData.letterboxd.rating)) {
    ratingCards.push(
      <div key="letterboxd" style={{ width: '100%' }}>
        {renderRatingCard(
          `/logos/letterboxd.png`,
          Number(ratingData.letterboxd.rating) * 2,
          `${formatRating.count(ratingData.letterboxd.rating_count)} 人评分`,
          true
        )}
      </div>
    );
  }

  if (ratingData.tmdb && isValidRatingData(ratingData.tmdb.rating)) {
    ratingCards.push(
      <div key="tmdb" style={{ width: '100%' }}>
        {renderRatingCard(
          `/logos/tmdb.png`,
          Number((ratingData.tmdb.rating).toFixed(1)),
          `${formatRating.count(ratingData.tmdb.voteCount)} 人评分`,
          true
        )}
      </div>
    );
  }

  if (!selectedSeason && ratingData.trakt && isValidRatingData(ratingData.trakt.rating)) {
    ratingCards.push(
      <div key="trakt" style={{ width: '100%' }}>
        {renderRatingCard(
          `/logos/trakt.png`,
          Number((ratingData.trakt.rating).toFixed(1)),
          `${formatRating.count(ratingData.trakt.votes)} 人评分`,
          true
        )}
      </div>
    );
  }

  // 横版布局
  if (layout === 'landscape') {
    return (
      <div style={styles.cardStyle}>
        {/* 左侧海报区域 */}
        <div style={styles.posterContainerStyle}>
          <div style={styles.posterGlassStyle}>
            {/* 毛玻璃磨砂纹理效果 */}
            <div style={styles.posterTextureStyle} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
              <div style={{ width: '100%', maxWidth: '260px', height: '390px', flexShrink: 0, borderRadius: '16px', overflow: 'hidden' }}>
                <img
                  src={media.poster || '/fallback-poster.jpg'}
                  alt={media.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '16px' }}
                  crossOrigin="anonymous"
                  loading="eager"
                />
              </div>
            </div>
            
            {/* 首页Logo */}
            <div style={{ 
              position: 'absolute', 
              bottom: '24px', 
              left: '24px', 
              zIndex: 100
            }}>
              <img
                src="/logos/home.png"
                alt="Home"
                style={{ 
                  display: 'block', 
                  width: '32px', 
                  height: '32px', 
                  objectFit: 'contain',
                  imageRendering: 'auto'
                }}
                crossOrigin="anonymous"
              />
            </div>
          </div>
        </div>

        {/* 右侧内容 */}
        <div style={{ flex: 1, marginLeft: '80px' }}>
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ 
              fontSize: '32px', 
              fontWeight: 'bold', 
              color: isDark ? '#ffffff' : '#111827', 
              margin: 0,
              lineHeight: 1.2
            }}>
              {media.title} <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>({media.year})</span>
            </h1>
            {overallRating && (
              <div style={{ marginTop: '16px' }}>
                <div style={styles.overallRatingStyle}>
                  <div style={styles.overallRatingGradientStyle}>
                    <div style={{ fontSize: '30px', fontWeight: 'bold', color: '#ffffff', whiteSpace: 'nowrap' }}>
                      {overallRating.toFixed(1)}
                    </div>
                    <div style={{ fontSize: '9px', color: 'rgba(255, 255, 255, 0.9)', marginTop: '4px', whiteSpace: 'nowrap' }}>
                      基于{validPlatformsCount}个平台的加权计算
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
            {ratingCards}
          </div>
        </div>
      </div>
    );
  }

  // 竖版布局
  return (
    <div style={{
      width: '887px',
      height: '1928px',
      backgroundColor: isDark ? '#0a0e1a' : '#f0f9ff',
      background: isDark 
        ? `linear-gradient(135deg, #0a0e1a 0%, #0f172a 50%, #1e293b 100%)`
        : `linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 50%, #bae6fd 100%)`,
      border: 'none',
      borderRadius: '0px',
      boxShadow: 'none',
      position: 'relative' as const,
      boxSizing: 'border-box' as const,
      overflow: 'hidden' as const,
      fontFamily: "'ShangGuDengKuan', 'Onest', system-ui, -apple-system, sans-serif" as const
    }}>
        {/* 海报区域 */}
        <div style={{ 
          position: 'absolute', 
          top: '135px', 
          left: '50%',
          transform: 'translateX(-50%)',
          width: '270px', 
          height: '405px',
          borderRadius: '16px', 
          overflow: 'hidden',
          zIndex: 10
        }}>
          <img
            src={media.poster || '/fallback-poster.jpg'}
            alt={media.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            crossOrigin="anonymous"
            loading="eager"
          />
        </div>

        {/* 片名 */}
        <div style={{ 
          position: 'absolute', 
          top: '560px',
          left: '50%',
          transform: 'translateX(-50%)',
          textAlign: 'center',
          width: '100%',
          padding: '0 50px',
          boxSizing: 'border-box' as const
        }}>
          <h1 style={{ 
            fontSize: '35px', 
            fontWeight: 'bold', 
            color: isDark ? '#ffffff' : '#111827', 
            margin: 0,
            lineHeight: 1.2
          }}>
            {media.title} <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>({media.year})</span>
          </h1>
        </div>

        {/* 左侧花环 */}
        {overallRating && (
          <div style={{ 
            position: 'absolute',
            top: '640px',
            left: '275px',
            width: '79px',
            height: '120px',
            zIndex: 15
          }}>
            <img
              src={isDark ? "/laurel-wreath-left-white.png" : "/laurel-wreath-left-dark.png"}
              alt="Left Laurel"
              style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'contain'
              }}
              crossOrigin="anonymous"
            />
          </div>
        )}

        {/* 右侧花环 */}
        {overallRating && (
          <div style={{ 
            position: 'absolute',
            top: '640px',
            right: '275px',
            width: '79px',
            height: '120px',
            zIndex: 15
          }}>
            <img
              src={isDark ? "/laurel-wreath-right-white.png" : "/laurel-wreath-right-dark.png"}
              alt="Right Laurel"
              style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'contain'
              }}
              crossOrigin="anonymous"
            />
          </div>
        )}

        {/* 综合评分 */}
        {overallRating && (
          <div style={{ 
            position: 'absolute',
            top: '640px',
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
            zIndex: 16
          }}>
            <div style={{ 
              fontSize: '100px', 
              fontWeight: 'bold', 
              color: isDark ? '#f1f5f9' : '#111827', 
              lineHeight: 1
            }}>
              {overallRating.toFixed(1)}
            </div>
            <div style={{ 
              fontSize: '15px', 
              color: isDark ? '#f1f5f9' : '#111827', 
              marginTop: '8px'
            }}>
              基于{validPlatformsCount}个平台的加权计算
            </div>
          </div>
        )}

        {/* 评分内容容器 */}
        <div style={{
          position: 'absolute',
          top: '790px',
          left: '50px',
          right: '50px',
          bottom: '200px',
          backgroundColor: isDark ? '#222B35' : '#c8e7f8',
          background: isDark 
            ? `linear-gradient(135deg, #222B35 0%, #1C232B 50%, #161B22 100%)`
            : `linear-gradient(180deg, #c2e9fb 0%, #b4d9fd 50%, #a1c4fd 100%)`,
          backdropFilter: 'blur(50px) saturate(200%)',
          WebkitBackdropFilter: 'blur(50px) saturate(200%)',
          border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(255, 255, 255, 0.6)',
          borderRadius: '16px',
          boxShadow: isDark
            ? `0 12px 40px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)`
            : `0 12px 40px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.06)`,
          boxSizing: 'border-box' as const
        }}>
          {/* 毛玻璃磨砂纹理效果 */}
          <div style={{
            position: 'absolute' as const,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: isDark
              ? `
                radial-gradient(circle at 20% 30%, rgba(59, 130, 246, 0.1) 0%, transparent 45%),
                radial-gradient(circle at 80% 70%, rgba(30, 58, 138, 0.08) 0%, transparent 45%),
                radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.05) 0%, transparent 50%),
                linear-gradient(135deg, rgba(59, 130, 246, 0.04) 0%, transparent 50%)
              `
              : `
                radial-gradient(circle at 20% 30%, rgba(255, 255, 255, 0.2) 0%, transparent 45%),
                radial-gradient(circle at 80% 70%, rgba(255, 255, 255, 0.15) 0%, transparent 45%),
                radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.1) 0%, transparent 50%),
                linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, transparent 50%),
                repeating-linear-gradient(
                  0deg,
                  transparent,
                  transparent 2px,
                  rgba(255, 255, 255, 0.02) 2px,
                  rgba(255, 255, 255, 0.02) 4px
                ),
                repeating-linear-gradient(
                  90deg,
                  transparent,
                  transparent 2px,
                  rgba(255, 255, 255, 0.02) 2px,
                  rgba(255, 255, 255, 0.02) 4px
                )
              `,
            pointerEvents: 'none' as const,
            zIndex: 0,
            opacity: isDark ? 0.6 : 0.9
          }} />

          {/* 评分卡片 */}
          <div style={{ 
            position: 'absolute',
            top: '40px',
            left: '25px',
            right: '25px',
            display: 'grid', 
            gridTemplateColumns: 'repeat(2, 1fr)', 
            gap: '25px',
            zIndex: 1,
            width: 'calc(100% - 50px)',
            boxSizing: 'border-box' as const
          }}>
            {ratingCards}
          </div>

          {/* 首页Logo */}
          <div style={{ 
            position: 'absolute', 
            bottom: '20px', 
            right: '20px', 
            zIndex: 100
          }}>
            <img
              src="/logos/home.png"
              alt="Home"
              crossOrigin="anonymous"
              style={{ 
                display: 'block', 
                width: '32px', 
                height: '32px', 
                objectFit: 'contain',
                imageRendering: 'auto'
              }}
            />
          </div>
        </div>
    </div>
  );
}
