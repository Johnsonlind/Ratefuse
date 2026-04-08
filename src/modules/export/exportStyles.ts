// ==========================================
// 导出场景样式配置
// ==========================================
export function getExportStyles(isDark: boolean) {
  return {
    cardStyle: {
      width: '1200px',
      minHeight: '902px',
      backgroundColor: isDark ? '#0a0e1a' : '#f0f9ff',
      background: isDark 
        ? `linear-gradient(135deg, #0a0e1a 0%, #0f172a 50%, #1e293b 100%)`
        : `linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 50%, #bae6fd 100%)`,
      backdropFilter: 'blur(50px) saturate(200%)',
      WebkitBackdropFilter: 'blur(50px) saturate(200%)',      
      border: 'none',
      borderRadius: '0px',
      padding: '50px',
      boxShadow: 'none',
      position: 'relative' as const,
      boxSizing: 'border-box' as const,
      overflow: 'hidden' as const,
      display: 'flex' as const,
      fontFamily: "'ShangGuDengKuan', 'Onest', system-ui, -apple-system, sans-serif" as const
    },

    posterContainerStyle: {
      width: '300px',
      marginLeft: '-20px',
      position: 'relative' as const,
      zIndex: 20
    },

    posterGlassStyle: {
      width: '100%',
      height: '100%',
      minHeight: '800px',
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
      position: 'relative' as const
    },

    ratingCardStyle: {
      backgroundColor: isDark ? '#090f19' : '#98a1a5',
      background: isDark ? '#090f19' : '#98a1a5',
      border: isDark ? '1px solid #2e384b' : '1px solid #f6fcff',
      borderRadius: '12px',
      padding: '24px',
      boxShadow: isDark
        ? `0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)`
        : `0 4px 16px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.6)`,
      color: '#ffffff',
      position: 'relative' as const
    },

    overallRatingStyle: {
      width: '112px',
      position: 'relative' as const
    },

    overallRatingGradientStyle: {
      background: isDark
        ? `linear-gradient(135deg, #db2777 0%, #be185d 50%, #9f1239 100%)`
        : `linear-gradient(135deg, #ec4899 0%, #d946ef 50%, #c026d3 100%)`,
      borderRadius: '12px',
      padding: '16px',
      minHeight: '70px',
      display: 'flex' as const,
      flexDirection: 'column' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      boxShadow: isDark
        ? `0 8px 24px rgba(219, 39, 119, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15)`
        : `0 8px 24px rgba(236, 72, 153, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)`
    },

    posterTextureStyle: {
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
    }
  };
}
