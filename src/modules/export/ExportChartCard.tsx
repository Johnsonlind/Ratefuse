// ==========================================
// 榜单导出卡片组件
// ==========================================
import { toSiteRelativePosterSrc } from '../../api/image';

interface ChartEntry {
  tmdb_id: number;
  rank: number;
  title: string;
  poster: string;
  media_type?: 'movie' | 'tv';
}

interface ExportChartCardProps {
  platform: string;
  chartName: string;
  entries: ChartEntry[];
  platformLogo?: string;
  layout?: 'portrait' | 'landscape';
}

export function ExportChartCard({ 
  platform, 
  chartName, 
  entries,
  platformLogo,
  layout = 'portrait'
}: ExportChartCardProps) {
  const processedEntries = entries.map(entry => {
    const posterUrl = entry.poster || '';
    if (!posterUrl || posterUrl.trim() === '') {
      return { ...entry, poster: '' };
    }
    if (posterUrl.startsWith('data:image/')) {
      return { ...entry, poster: posterUrl };
    }
    return { ...entry, poster: toSiteRelativePosterSrc(posterUrl, 'original') };
  });

  const isDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';

  // 横版布局
  if (layout === 'landscape') {
    const rows = [];
    for (let i = 0; i < processedEntries.length; i += 5) {
      rows.push(processedEntries.slice(i, i + 5));
    }

    const cardStyle = {
      width: '1200px',
      minHeight: '902px',
      backgroundColor: isDark ? '#0a0e1a' : '#e0f2fe',
      background: isDark 
        ? `linear-gradient(135deg, #0a0e1a 0%, #0f172a 50%, #1e293b 100%)`
        : `linear-gradient(135deg, #e0f2fe 0%, #bae6fd 50%, #7dd3fc 100%)`,
      backdropFilter: 'blur(50px) saturate(200%)',
      WebkitBackdropFilter: 'blur(50px) saturate(200%)',
      border: 'none',
      borderRadius: '0px',
      padding: '50px', 
      boxShadow: 'none',
      position: 'relative' as const,
      boxSizing: 'border-box' as const,
      overflow: 'hidden' as const,
      fontFamily: "'ShangGuDengKuan', 'Onest', system-ui, -apple-system, sans-serif" as const
    };

    const chartContentContainerStyle = {
      width: '100%',
      backgroundColor: isDark ? '#222B35' : '#c8e7f8',
      background: isDark 
        ? `linear-gradient(135deg, #222B35 0%, #1C232B 50%, #161B22 100%)`
        : `linear-gradient(180deg, #c2e9fb 0%, #b4d9fd 50%, #a1c4fd 100%)`,
      backdropFilter: 'blur(50px) saturate(200%)',
      WebkitBackdropFilter: 'blur(50px) saturate(200%)',
      border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(255, 255, 255, 0.6)',
      borderRadius: '16px',
      padding: '24px',
      boxShadow: isDark
        ? `0 12px 40px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)`
        : `0 12px 40px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.06)`,
      position: 'relative' as const,
      zIndex: 1
    };

    return (
      <div style={cardStyle}>
        {/* 毛玻璃磨砂纹理效果 */}
        <div style={{
            position: 'absolute',
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
            pointerEvents: 'none',
            zIndex: 0,
            opacity: isDark ? 0.6 : 0.9
          }} />
        {/* 榜单顶部标题区域 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '40px', position: 'relative', zIndex: 1 }}>
            {platformLogo && (
              <img 
                src={platformLogo} 
                alt={platform}
                style={{ 
                  width: '40px', 
                  height: '40px', 
                  objectFit: 'contain', 
                  display: 'block',
                  imageRendering: 'auto'
                }}
                crossOrigin="anonymous"
              />
            )}
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: isDark ? '#e5e7eb' : '#111827', margin: 0, lineHeight: '1.3', marginBottom: '4px' }}>
                {platform}
              </h1>
              <h2 style={{ fontSize: '18px', fontWeight: '500', color: isDark ? '#9ca3af' : '#374151', margin: 0, lineHeight: '1.4' }}>
                {chartName}
              </h2>
            </div>
        </div>

        {/* 榜单内容 */}
        <div style={chartContentContainerStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative', zIndex: 1 }}>
            {rows.map((row, rowIdx) => (
              <div key={rowIdx} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
                {row.map(entry => {
                  return (
                    <div key={`${entry.tmdb_id}-${entry.rank}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                      <div style={{ width: '100%', position: 'relative' }}>
                        <div 
                          style={{ 
                            aspectRatio: '2/3',
                            borderRadius: '10px',
                            overflow: 'hidden',
                            position: 'relative',
                            width: '100%',
                            boxShadow: 'none',
                            background: 'transparent'
                          }}
                        >
                          {entry.poster && entry.poster.trim() !== '' ? (
                            <img
                              src={entry.poster}
                              alt={entry.title}
                              data-export-poster-key={`${entry.tmdb_id}-${entry.rank}`}
                              crossOrigin="anonymous"
                              loading="eager"
                              style={{ 
                                display: 'block',
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                borderRadius: '10px',
                                boxShadow: 'none',
                                filter: 'none'
                              }}
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                if (target.src.startsWith('data:')) return;
                                target.style.display = 'none';
                                const parent = target.parentElement;
                                if (parent && !parent.querySelector('.placeholder')) {
                                  const placeholder = document.createElement('div');
                                  placeholder.className = 'placeholder w-full h-full flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 rounded-xl';
                                  placeholder.textContent = '无海报';
                                  parent.appendChild(placeholder);
                                }
                              }}
                            />
                          ) : (
                            <div style={{ 
                              width: '100%', 
                              height: '100%', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              fontSize: '12px', 
                              color: '#6b7280', 
                              backgroundColor: '#e5e7eb',
                              borderRadius: '10px'
                            }}>
                              无海报
                            </div>
                          )}
                          {/* 排名数字 */}
                          <span
                            style={{
                              position: 'absolute',
                              top: 4,
                              left: 6,
                              zIndex: 10,
                              pointerEvents: 'none',
                              background: 'linear-gradient(to bottom, #fff 50%,rgb(78, 76, 76) 100%)',
                              WebkitBackgroundClip: 'text',
                              color: 'transparent',
                              fontSize: entry.rank === 1 ? 'clamp(36px, 5.6vw, 56px)' : 'clamp(28px, 4.4vw, 44px)',
                              fontWeight: 'bold',
                              filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.95)) drop-shadow(0 0 4px rgba(0,0,0,0.85)) drop-shadow(2px 0px 8.1px rgba(0,0,0,0.5))',
                              lineHeight: '1',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {chartName === '豆瓣2025评分月度热搜影视' && entry.rank >= 1 && entry.rank <= 12
                              ? `${entry.rank}月`
                              : entry.rank}
                          </span>
                        </div>
                        <div style={{ 
                          marginTop: '8px', 
                          fontSize: '16px', 
                          textAlign: 'center', 
                          color: isDark ? '#e5e7eb' : '#111827', 
                          fontWeight: '500',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          lineHeight: '1.4',
                          minHeight: '36px',
                          maxHeight: '36px'
                        }}>
                          {entry.title}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* 填充空位 */}
                {Array.from({ length: 5 - row.length }).map((_, idx) => (
                  <div key={`empty-${idx}`} style={{ aspectRatio: '2/3' }} />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* 首页Logo */}
        <div style={{ 
            position: 'absolute', 
            bottom: '24px', 
            right: '10px', 
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
    );
  }

  // 竖版布局
  const top1Entry = processedEntries[0];
  const remainingEntries = processedEntries.slice(1);

  const rows = [];
  for (let i = 0; i < remainingEntries.length; i += 3) {
    rows.push(remainingEntries.slice(i, i + 3));
  }
  
  const cardStyle = {
    width: '887px',
    height: '1928px',
    backgroundColor: isDark ? '#0f172a' : '#bfd9f5',
    background: isDark 
      ? 'linear-gradient(180deg, #0f172a 0%, #1e293b 25%, #334155 50%, #475569 75%, #64748b 100%)'
      : 'linear-gradient(180deg, #c0daf6 0%, #b8d3ed 25%, #b5cee7 50%, #b3c9e3 75%, #b5c6e0 100%)',
    borderRadius: '0px',
    padding: '0px',
    position: 'relative' as const,
    boxSizing: 'border-box' as const,
    overflow: 'visible' as const,
    fontFamily: "'ShangGuDengKuan', 'Onest', system-ui, -apple-system, sans-serif" as const
  };

  const chartContentContainerStyle = {
    position: 'absolute' as const,
    top: '350px',
    left: '50px',
    right: '50px',
    bottom: '150px',
    width: '787px',
    backgroundColor: isDark ? '#1e293b' : '#c8e7f8',
    background: isDark 
      ? 'linear-gradient(180deg, #1e293b 0%, #334155 50%, #475569 100%)'
      : 'linear-gradient(180deg, #d8f0fc 0%, #ceeaf8 50%, #c4e4f5 100%)',
    borderRadius: '16px',
    padding: '0px',
    boxSizing: 'border-box' as const,
    overflow: 'hidden' as const
  };

  return (
    <div style={cardStyle}>
      {/* 平台Logo */}
      {platformLogo && (
        <div style={{ 
          position: 'absolute',
          top: '135px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10
        }}>
          <img 
            src={platformLogo} 
            alt={platform}
            style={{ 
              width: '105px', 
              height: '105px', 
              objectFit: 'contain', 
              display: 'block',
              imageRendering: 'auto'
            }}
            crossOrigin="anonymous"
          />
        </div>
      )}
      
      {/* 标题装饰 */}
      <div style={{
        position: 'absolute',
        top: '250px',
        left: '0',
        right: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        zIndex: 10
      }}>
        {/* 左侧花环 */}
        <img 
          src={isDark ? "/laurel-wreath-left-white.png" : "/laurel-wreath-left-dark.png"}
          alt=""
          crossOrigin="anonymous"
          style={{ 
            width: '54px',
            height: '83px',
            objectFit: 'contain',
            flexShrink: 0
          }}
        />
        
        {/* 榜单名称 */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
          flexShrink: 0
        }}>
          <div style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: isDark ? '#f1f5f9' : '#111827',
            letterSpacing: '0.05em',
            whiteSpace: 'nowrap'
          }}>
            {chartName}
          </div>
          
          {/* 榜单平台 */}
          <div style={{
            fontSize: '16px',
            fontWeight: '500',
            color: isDark ? '#f1f5f9' : '#111827',
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap'
          }}>
            {platform}
          </div>
        </div>
        
        {/* 右侧花环 */}
        <img 
          src={isDark ? "/laurel-wreath-right-white.png" : "/laurel-wreath-right-dark.png"}
          alt=""
          crossOrigin="anonymous"
          style={{ 
            width: '54px',
            height: '83px',
            objectFit: 'contain',
            flexShrink: 0
          }}
        />
      </div>

      {/* 榜单内容容器 */}
      <div style={chartContentContainerStyle}>
        {/* 右上角Logo */}
        <div style={{ 
          position: 'absolute', 
          top: '20px', 
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

        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '0px',
          padding: '0px 30px'
        }}>
          
          {/* Top1海报区域 */}
          {top1Entry && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              paddingTop: '20px',
              paddingBottom: '12px'
            }}>
              <div style={{ position: 'relative', width: '240px' }}>
                {/* 排名数字 */}
                <span
                  style={{
                    position: 'absolute',
                    top: 4,
                    left: 6,
                    zIndex: 10,
                    background: 'linear-gradient(to bottom, #fff 50%,rgb(78, 76, 76) 100%)',
                    WebkitBackgroundClip: 'text',
                    color: 'transparent',
                    fontSize: 'clamp(40px, 6.4vw, 64px)',
                    fontWeight: 'bold',
                    filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.95)) drop-shadow(0 0 4px rgba(0,0,0,0.85)) drop-shadow(2px 0px 8.1px rgba(0,0,0,0.5))',
                    lineHeight: '1',
                    whiteSpace: 'nowrap',
                  }}
                >
                  1
                </span>
                
                {/* 海报 */}
                <div style={{
                  width: '240px',
                  height: '360px',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                }}>
                  {top1Entry.poster && top1Entry.poster.trim() !== '' ? (
                    <img
                      src={top1Entry.poster}
                      alt={top1Entry.title}
                      data-export-poster-key={`${top1Entry.tmdb_id}-${top1Entry.rank}`}
                      crossOrigin="anonymous"
                      loading="eager"
                      style={{ 
                        display: 'block',
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                    />
                  ) : (
                    <div style={{ 
                      width: '100%', 
                      height: '100%', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: '14px', 
                      color: '#6b7280', 
                      backgroundColor: '#e5e7eb'
                    }}>
                      无海报
                    </div>
                  )}
                </div>
                
                {/* 片名 */}
                <div style={{ 
                  marginTop: '12px', 
                  fontSize: '20px', 
                  textAlign: 'center', 
                  color: isDark ? '#f1f5f9' : '#111827', 
                  fontWeight: 'bold',
                  lineHeight: '1',
                  minHeight: '23px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical'
                }}>
                  {top1Entry.title}
                </div>
              </div>
            </div>
          )}

          {/* 2-10名区域 */}
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '12px',
          }}>
            {rows.map((row, rowIdx) => (
              <div key={rowIdx} style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(3, 180px)', 
                gap: '33.5px',
                justifyContent: 'center'
              }}>
                {row.map(entry => {
                  return (
                    <div key={`${entry.tmdb_id}-${entry.rank}`} style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                      <div style={{ width: '180px', position: 'relative' }}>
                        {/* 排名数字 */}
                        <span
                          style={{
                            position: 'absolute',
                            top: 4,
                            left: 6,
                            zIndex: 10,
                            background: 'linear-gradient(to bottom, #fff 50%,rgb(78, 76, 76) 100%)',
                            WebkitBackgroundClip: 'text',
                            color: 'transparent',
                            fontSize: 'clamp(32px, 5.2vw, 48px)',
                            fontWeight: 'bold',
                            filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.95)) drop-shadow(0 0 4px rgba(0,0,0,0.85)) drop-shadow(2px 0px 8.1px rgba(0,0,0,0.5))',
                            lineHeight: '1',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {entry.rank}
                        </span>
                        
                        <div 
                          style={{ 
                            width: '180px',
                            height: '270px',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            position: 'relative',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                          }}
                        >
                          {entry.poster && entry.poster.trim() !== '' ? (
                            <img
                              src={entry.poster}
                              alt={entry.title}
                              data-export-poster-key={`${entry.tmdb_id}-${entry.rank}`}
                              crossOrigin="anonymous"
                              loading="eager"
                              style={{ 
                                display: 'block',
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover'
                              }}
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                if (target.src.startsWith('data:')) return;
                                target.style.display = 'none';
                                const parent = target.parentElement;
                                if (parent && !parent.querySelector('.placeholder')) {
                                  const placeholder = document.createElement('div');
                                  placeholder.className = 'placeholder';
                                  placeholder.style.width = '100%';
                                  placeholder.style.height = '100%';
                                  placeholder.style.display = 'flex';
                                  placeholder.style.alignItems = 'center';
                                  placeholder.style.justifyContent = 'center';
                                  placeholder.style.fontSize = '12px';
                                  placeholder.style.color = '#6b7280';
                                  placeholder.style.backgroundColor = '#e5e7eb';
                                  placeholder.textContent = '无海报';
                                  parent.appendChild(placeholder);
                                }
                              }}
                            />
                          ) : (
                            <div style={{ 
                              width: '100%', 
                              height: '100%', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              fontSize: '12px', 
                              color: '#6b7280', 
                              backgroundColor: '#e5e7eb'
                            }}>
                              无海报
                            </div>
                          )}
                        </div>
                        
                        {/* 片名 */}
                        <div style={{ 
                          marginTop: '8px', 
                          fontSize: '20px', 
                          textAlign: 'center', 
                          color: isDark ? '#f1f5f9' : '#111827', 
                          fontWeight: '500',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          lineHeight: '1',
                          minHeight: '23px'
                        }}>
                          {entry.title}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* 填充空位 */}
                {Array.from({ length: 3 - row.length }).map((_, idx) => (
                  <div key={`empty-${idx}`} style={{ width: '100%' }} />
                ))}
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
