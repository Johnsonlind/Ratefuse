// ==========================================
// 资源图标资源映射工具
// ==========================================
import type { ResourceType } from '../../api/resources';

export const RESOURCE_LOGO_SRC: Record<ResourceType, string> = {
  baidu: '/logos/baidu.png',
  quark: '/logos/quark.png',
  xunlei: '/logos/xunlei.png',
  '115': '/logos/115.png',
  uc: '/logos/uc.png',
  ali: '/logos/ali.png',
  magnet: '/logos/magnet.png',
};

export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  baidu: '百度网盘',
  quark: '夸克网盘',
  xunlei: '迅雷',
  '115': '115',
  uc: 'UC网盘',
  ali: '阿里云盘',
  magnet: '磁力',
};
