// ==========================================
// 文案常量模块
// ==========================================
export const messages = {
  errors: {
    exportFailed: '导出图片失败',
    loadMovieFailed: '加载电影详情失败',
    loadTVShowFailed: '加载剧集详情失败',
    loadRatingsFailed: '加载评分失败',
    noResults: '未找到相关影视作品',
  },
  loading: '加载中...',
  search: {
    placeholder: '搜索电影或电视剧...',
    title: '电影评分中心',
    subtitle: '搜索并对比多平台电影评分',
  },
  export: {
    button: '导出评分',
  },
  ratings: {
    loading: '正在加载评分数据...',
    error: '获取评分数据失败',
    noData: '暂无评分数据',
  },
} as const;
