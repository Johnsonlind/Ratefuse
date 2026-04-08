// ==========================================
// 认证请求封装层
// ==========================================
type AuthFetchInit = RequestInit & {
  withAuth?: boolean;
};

export function authFetch(input: RequestInfo | URL, init: AuthFetchInit = {}) {
  const { withAuth = true, headers, ...rest } = init;
  const finalHeaders = new Headers(headers);

  if (withAuth) {
    const token = localStorage.getItem('token');
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, {
    ...rest,
    headers: finalHeaders,
  });
}

export async function authFetchJson<T>(input: RequestInfo | URL, init: AuthFetchInit = {}) {
  const res = await authFetch(input, init);
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = typeof data?.detail === 'string' ? data.detail : '';
    } catch {
    }
    throw new Error(detail || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}
