/**
 * 会员商业化总开关。生产暂缓上线时保持默认 false，并与后端环境变量 MEMBERSHIP_ENABLED 保持一致。
 * 启用时构建：VITE_MEMBERSHIP_ENABLED=true
 */
export const MEMBERSHIP_ENABLED =
  String(import.meta.env.VITE_MEMBERSHIP_ENABLED || '').toLowerCase() === 'true';
