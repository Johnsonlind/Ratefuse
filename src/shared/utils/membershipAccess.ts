// ==========================================
// 会员权限判断工具
// ==========================================
import { MEMBERSHIP_ENABLED } from '../../config/features';

/**
 * 是否可使用原「会员专属」能力（资源区、导出等）。会员功能关闭时不展示也不开放。
 */
export function hasMemberPrivileges(user: { is_member?: boolean } | null | undefined): boolean {
  if (!MEMBERSHIP_ENABLED) return false;
  if (!user) return false;
  return !!user.is_member;
}
