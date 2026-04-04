// ==========================================
// 用户检索 API 模块
// ==========================================
import { authFetchJson } from './authFetch';

export interface UserSearchItem {
  id: number;
  username: string;
  avatar: string | null;
  is_following: boolean;
}

export interface UserSearchResponse {
  list: UserSearchItem[];
  total: number;
}

export async function searchUsers(params: {
  q: string;
  limit?: number;
  offset?: number;
}): Promise<UserSearchResponse> {
  const sp = new URLSearchParams();
  sp.set('q', params.q);
  if (params.limit != null) sp.set('limit', String(params.limit));
  if (params.offset != null) sp.set('offset', String(params.offset));

  return await authFetchJson<UserSearchResponse>(`/api/users/search?${sp.toString()}`);
}
