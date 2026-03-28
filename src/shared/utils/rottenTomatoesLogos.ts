// ==========================================
// RT 图标资源映射工具
// ==========================================
export function getCriticLogo(score: number | undefined) {
  if (!score) return `/logos/rottentomatoes.png`;
  
  if (score >= 70) {
    return `/logos/rottentomatoes_critics_fresh.png`;
  } else if (score >= 60) {
    return `/logos/rottentomatoes.png`;
  } else {
    return `/logos/rottentomatoes_critics_rotten.png`;
  }
}

export function getAudienceLogo(score: number | undefined) {
  if (!score) return `/logos/rottentomatoes_audience.png`;
  
  if (score >= 90) {
    return `/logos/rottentomatoes_audience_hot.png`;
  } else if (score >= 60) {
    return `/logos/rottentomatoes_audience.png`;
  } else {
    return `/logos/rottentomatoes_audience_rotten.png`;
  }
} 
