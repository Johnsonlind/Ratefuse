// ==========================================
// 职务映射类型模块
// ==========================================
export const jobTitleMap: Record<string, string> = {
  'Director': '导演',
  'Producer': '制片人',
  'Executive Producer': '执行制片人',
  'Writer': '编剧',
  'Screenplay': '剧本',
  'Story': '故事',
  'Director of Photography': '摄影指导',
  'Production Design': '制作设计',
  'Art Direction': '艺术指导',
  'Set Decoration': '布景设计',
  'Costume Design': '服装设计',
  'Makeup Department Head': '化妆部门主管',
  'Sound': '音响',
  'Sound Designer': '音效设计',
  'Visual Effects': '视觉效果',
  'Visual Effects Supervisor': '视觉效果总监',
  'Editor': '剪辑',
  'Casting': '选角导演',
  'Music': '音乐',
  'Original Music Composer': '原创音乐',
  'Music Supervisor': '音乐总监',
  // 添加更多职位映射...
};

export function getChineseJobTitle(englishTitle: string): string {
  return jobTitleMap[englishTitle] || englishTitle;
} 
