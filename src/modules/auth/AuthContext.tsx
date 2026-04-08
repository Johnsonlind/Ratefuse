// ==========================================
// 认证状态管理（React Context）
// ==========================================
import { createContext, useContext, useState, useEffect } from 'react';

interface User {
  id: number;
  email: string;
  username: string;
  avatar: string | null;
  is_admin?: boolean;
  is_member?: boolean;
  member_expired_at?: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => void;
  updateUserInfo: (user: User) => void;
  sendPasswordResetEmail: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const getCacheMaxAge = () => {
    return localStorage.getItem('remember_me') === '1'
      ? 24 * 60 * 60 * 1000
      : 30 * 60 * 1000;
  };

  const isCacheValid = (timestamp: number) => {
    const now = Date.now();
    return (now - timestamp) < getCacheMaxAge();
  };

  useEffect(() => {
    const cachedUser = localStorage.getItem('cachedUserInfo');
    const token = localStorage.getItem('token');
    const rememberMe = localStorage.getItem('remember_me') === '1';
    const hasAuth = token || rememberMe;

    if (cachedUser && hasAuth) {
      try {
        const parsedCache = JSON.parse(cachedUser);
        if (parsedCache.timestamp && isCacheValid(parsedCache.timestamp)) {
          setUser(parsedCache.data);
          setIsLoading(false);
          fetchUser(true);
          return;
        }
      } catch (e) {
        console.error('解析缓存用户信息失败:', e);
        localStorage.removeItem('cachedUserInfo');
      }
    }

    if (hasAuth) {
      fetchUser();
    } else {
      setIsLoading(false);
    }
  }, []);

  const fetchUser = async (background = false) => {
    if (!background) setIsLoading(true);
    const token = localStorage.getItem('token');
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const response = await fetch('/api/user/me', {
        headers,
        credentials: 'include',
        cache: 'no-store',
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        const cacheData = { data: userData, timestamp: Date.now() };
        localStorage.setItem('cachedUserInfo', JSON.stringify(cacheData));
      } else if (response.status === 401) {
        if (token) {
          localStorage.removeItem('token');
          localStorage.removeItem('cachedUserInfo');
          localStorage.removeItem('remember_me');
          setUser(null);
        } else if (!background) {
          localStorage.removeItem('cachedUserInfo');
          localStorage.removeItem('remember_me');
          setUser(null);
        }
      }
    } catch (error) {
      console.error('获取用户信息失败:', error);
    } finally {
      if (!background) setIsLoading(false);
    }
  };

  const login = async (email: string, password: string, rememberMe: boolean = false) => {
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15000);

      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, remember_me: rememberMe }),
        signal: controller.signal,
      }).finally(() => {
        window.clearTimeout(timeoutId);
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail);
      }

      let data: any = null;
      try {
        data = await response.json();
      } catch (_) {
        data = null;
      }

      if (!data) {
        throw new Error('登录失败：响应为空');
      }
      const userData = data.user ?? {};
      if (userData.id == null) return;

      if (rememberMe) {
        localStorage.setItem('remember_me', '1');
        localStorage.removeItem('token');
      } else {
        localStorage.setItem('token', data.access_token);
        localStorage.removeItem('remember_me');
      }
      setUser({
        id: userData.id,
        email: userData.email ?? '',
        username: userData.username ?? '',
        avatar: userData.avatar ?? null,
        is_admin: userData.is_admin ?? false,
        is_member: userData.is_member ?? false,
        member_expired_at: userData.member_expired_at ?? null,
      });
      const cacheData = { data: userData, timestamp: Date.now() };
      localStorage.setItem('cachedUserInfo', JSON.stringify(cacheData));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('登录超时，请稍后重试');
      }
      console.error('登录失败:', error);
      throw error;
    }
  };

  const updateUserInfo = (updatedUser: User) => {
    setUser(updatedUser);
    
    const cacheData = {
      data: updatedUser,
      timestamp: Date.now()
    };
    localStorage.setItem('cachedUserInfo', JSON.stringify(cacheData));
  };

  const logout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (_) {}
    localStorage.removeItem('token');
    localStorage.removeItem('cachedUserInfo');
    localStorage.removeItem('remember_me');
    setUser(null);
    setTimeout(() => {
      window.location.href = '/';
    }, 0);
  };

  const register = async (email: string, username: string, password: string) => {
    const response = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password })
    });

    const contentType = response.headers.get('content-type') || '';
    let parsedBody: any = null;
    try {
      if (contentType.includes('application/json')) {
        parsedBody = await response.json();
      } else {
        const text = await response.text();
        parsedBody = text ? { message: text } : null;
      }
    } catch (_) {
      parsedBody = null;
    }

    if (!response.ok) {
      const message = (parsedBody && (parsedBody.detail || parsedBody.message))
        || `请求失败（${response.status}）`;
      throw new Error(message);
    }

    if (!parsedBody) {
      throw new Error('注册成功但响应为空');
    }

    localStorage.setItem('token', parsedBody.access_token);
    setUser(parsedBody.user);
  };

  const sendPasswordResetEmail = async (email: string): Promise<void> => {
    const response = await fetch('/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail);
    }
  };

  const resetPassword = async (token: string, password: string): Promise<void> => {
    const response = await fetch('/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isLoading, 
      login, 
      register, 
      logout,
      updateUserInfo,
      sendPasswordResetEmail,
      resetPassword
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
