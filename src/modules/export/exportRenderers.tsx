// ==========================================
// 导出渲染函数工厂
// ==========================================
import { getCriticLogo, getAudienceLogo } from '../../shared/utils/rottenTomatoesLogos';

interface ExportRenderersProps {
  ratingCardStyle: React.CSSProperties;
}

export function createExportRenderers({ ratingCardStyle }: ExportRenderersProps) {
  const renderRatingCard = (logo: string, rating: number, label?: string, showStars: boolean = false) => (
    <div style={ratingCardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
        <img 
          src={logo} 
          alt="" 
          style={{ 
            width: '40px',
            height: '40px',
            objectFit: 'contain', 
            flexShrink: 0,
            imageRendering: 'auto'
          }}
          crossOrigin="anonymous"
        />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '36px', fontWeight: 'bold', lineHeight: 1, color: '#ffffff', whiteSpace: 'nowrap' }}>
              {rating.toFixed(1)}
            </span>
          </div>
          {label && (
            <div style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)', marginTop: '4px' }}>
              {label}
            </div>
          )}
          {showStars && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '2px' }}>
              {[...Array(5)].map((_, i) => {
                const starValue = (rating / 10) * 5;
                const isFull = i < Math.floor(starValue);
                const isHalf = i === Math.floor(starValue) && starValue % 1 >= 0.3;
                return (
                  <span key={i} style={{ fontSize: '16px', color: isFull || isHalf ? '#fbbf24' : '#6b7280' }}>
                    {isFull ? '★' : isHalf ? '☆' : '☆'}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderRottenTomatoesCard = (
    criticScore?: number,
    audienceScore?: number,
    criticReviews?: string,
    audienceReviews?: string,
    criticAvg?: string,
    audienceAvg?: string
  ) => {
    if (!criticScore && !audienceScore) return null;
    
    return (
      <div style={ratingCardStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {typeof criticScore === 'number' && criticScore > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <img 
                src={getCriticLogo(criticScore)}
                alt=""
                style={{ 
                  width: '40px',
                  height: '40px',
                  objectFit: 'contain', 
                  flexShrink: 0,
                  imageRendering: 'auto'
                }}
                crossOrigin="anonymous"
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{ fontSize: '36px', fontWeight: 'bold', lineHeight: 1, color: '#ffffff', whiteSpace: 'nowrap' }}>
                    {criticScore}%
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)' }}>专业新鲜度</span>
                    {criticReviews && (
                      <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)', marginTop: '4px' }}>
                        {criticReviews.replace(/ Reviews| Ratings/g, '')} 个专业评价
                      </span>
                    )}
                    {criticAvg && criticAvg !== '暂无' && criticAvg !== '0' && (
                      <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)', marginTop: '4px' }}>
                        平均新鲜度 {criticAvg.includes('/') ? criticAvg : `${criticAvg}/10`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {typeof audienceScore === 'number' && audienceScore > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <img 
                src={getAudienceLogo(audienceScore)}
                alt=""
                style={{ 
                  width: '40px',
                  height: '40px',
                  objectFit: 'contain', 
                  flexShrink: 0,
                  imageRendering: 'auto'
                }}
                crossOrigin="anonymous"
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{ fontSize: '36px', fontWeight: 'bold', lineHeight: 1, color: '#ffffff', whiteSpace: 'nowrap' }}>
                    {audienceScore}%
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)' }}>观众评分</span>
                    {audienceReviews && (
                      <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)', marginTop: '4px' }}>
                        {audienceReviews.replace(/ Reviews| Ratings/g, '')}人评分
                      </span>
                    )}
                    {audienceAvg && audienceAvg !== '暂无' && audienceAvg !== '0' && (
                      <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)', marginTop: '4px' }}>
                        平均评分 {audienceAvg.includes('/') ? audienceAvg : `${audienceAvg}/5`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderMetacriticCard = (metascore?: number, userScore?: number, criticReviews?: string, userReviews?: string) => {
    if (!metascore && !userScore) return null;
    
    return (
      <div style={ratingCardStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {typeof metascore === 'number' && metascore > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <img 
                src="/logos/metacritic.png"
                alt=""
                style={{ 
                  width: '40px',
                  height: '40px',
                  objectFit: 'contain', 
                  flexShrink: 0,
                  imageRendering: 'auto'
                }}
                crossOrigin="anonymous"
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{ fontSize: '36px', fontWeight: 'bold', lineHeight: 1, color: '#ffffff', whiteSpace: 'nowrap' }}>
                    {metascore}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)' }}>专业评分</span>
                    {criticReviews && (
                      <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)', marginTop: '4px' }}>
                        {criticReviews} 个专业评价
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {typeof userScore === 'number' && userScore > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <img 
                src="/logos/metacritic_audience.png"
                alt=""
                style={{ 
                  width: '40px',
                  height: '40px',
                  objectFit: 'contain', 
                  flexShrink: 0,
                  imageRendering: 'auto'
                }}
                crossOrigin="anonymous"
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{ fontSize: '36px', fontWeight: 'bold', lineHeight: 1, color: '#ffffff', whiteSpace: 'nowrap' }}>
                    {userScore.toFixed(1)}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)' }}>用户评分</span>
                    {userReviews && (
                      <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)', marginTop: '4px' }}>
                        {userReviews} 人评分
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return {
    renderRatingCard,
    renderRottenTomatoesCard,
    renderMetacriticCard
  };
}
