// ==========================================
// 应用路由与全局 Provider 组装层
// ==========================================
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../modules/auth/AuthContext';
import { Toaster } from 'sonner';
import { useLenis } from '../shared/hooks/useLenis';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  },
});

const routerOptions = {
  future: {
    v7_startTransition: true,
    v7_relativeSplatPath: true
  }
};

const HomePage = lazy(() => import('../pages/HomePage'));
const MoviePage = lazy(() => import('../pages/MoviePage'));
const TVShowPage = lazy(() => import('../pages/TVShowPage'));
const ProfilePage = lazy(() => import('../pages/ProfilePage'));
const UserProfilePage = lazy(() => import('../pages/UserProfilePage'));
const FavoriteListPage = lazy(() => import('../pages/FavoriteListPage'));
const NotificationsPage = lazy(() => import('../pages/NotificationsPage'));
const ResetPasswordPage = lazy(() => import('../pages/ResetPasswordPage'));
const AuthConfirmPage = lazy(() => import('../pages/AuthConfirmPage'));
const AuthErrorPage = lazy(() => import('../pages/AuthErrorPage'));
const AdminLayout = lazy(() => import('../modules/layout/AdminLayout'));
const AdminDashboardPage = lazy(() => import('../pages/admin/AdminDashboardPage'));
const AdminChartsPage = lazy(() => import('../pages/admin/AdminChartsPage'));
const AdminRatingInputPage = lazy(() => import('../pages/admin/AdminRatingInputPage'));
const AdminRatingEditPage = lazy(() => import('../pages/admin/AdminRatingEditPage'));
const AdminDetailViewsPage = lazy(() => import('../pages/admin/AdminDetailViewsPage'));
const AdminOtherPage = lazy(() => import('../pages/admin/AdminOtherPage'));
const AdminFeedbackPage = lazy(() => import('../pages/admin/AdminFeedbackPage'));
const AdminPlatformStatusPage = lazy(() => import('../pages/admin/AdminPlatformStatusPage'));
const AdminResourcesPage = lazy(() => import('../pages/admin/AdminResourcesPage'));
const AdminUsersPage = lazy(() => import('../pages/admin/AdminUsersPage'));
const AdminMediaLinkMappingPage = lazy(() => import('../pages/admin/AdminMediaLinkMappingPage'));
const ChartsPage = lazy(() => import('../pages/ChartsPage'));
const ChartDetailPage = lazy(() => import('../pages/ChartDetailPage'));

function App() {
  useLenis();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter {...routerOptions}>
          <div className="min-h-screen">
            <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-gray-500 dark:text-gray-400 text-sm" aria-busy="true">加载中...</div>}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/movie/:id" element={<MoviePage />} />
                <Route path="/tv/:id" element={<TVShowPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/auth/confirm" element={<AuthConfirmPage />} />
                <Route path="/auth/auth-code-error" element={<AuthErrorPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/favorite-lists/:id" element={<FavoriteListPage />} />
                <Route path="/profile/:id" element={<UserProfilePage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/charts" element={<ChartsPage />} />
                <Route path="/charts/:platform/:chartName" element={<ChartDetailPage />} />
                {/* 管理员后台 */}
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<AdminDashboardPage />} />
                  <Route path="users" element={<AdminUsersPage />} />
                  <Route path="charts" element={<AdminChartsPage />} />
                  <Route path="ratings/input" element={<AdminRatingInputPage />} />
                  <Route path="ratings/edit" element={<AdminRatingEditPage />} />
                  <Route path="feedbacks" element={<AdminFeedbackPage />} />
                  <Route path="detail-views" element={<AdminDetailViewsPage />} />
                  <Route path="platform-status" element={<AdminPlatformStatusPage />} />
                  <Route path="resources" element={<AdminResourcesPage />} />
                  <Route path="media-link-mapping" element={<AdminMediaLinkMappingPage />} />
                  <Route path="other" element={<AdminOtherPage />} />
                </Route>
              </Routes>
            </Suspense>
          </div>
        </BrowserRouter>
        <Toaster position="top-center" duration={1800} />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
