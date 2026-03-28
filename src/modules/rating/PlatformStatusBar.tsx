// ==========================================
// 平台状态条组件
// ==========================================
import type { FetchStatus, BackendPlatformStatus } from '../../shared/types/status';
import ErrorMessage from '../../shared/ui/ErrorMessage';

interface PlatformStatusBarProps {
  backendStatuses: BackendPlatformStatus[];
  tmdbStatus: FetchStatus;
  traktStatus: FetchStatus;
  onRetry: (platform: string) => void;
}

const getStatusColor = (status: FetchStatus) => {
  switch (status) {
    case 'successful':
      return { text: '获取成功', color: 'bg-green-500' };
    case 'loading':
      return { text: '正在获取', color: 'bg-blue-500' };
    case 'pending':
      return { text: '等待获取', color: 'bg-gray-400' };
    case 'error':
    case 'fail':
      return { text: '获取失败', color: 'bg-red-500' };
    case 'rate_limit':
      return { text: '访问限制', color: 'bg-red-500' };
    case 'timeout':
      return { text: '请求超时', color: 'bg-red-500' };
    case 'not_found':
    case 'locked':
      return { text: '未收录', color: 'bg-gray-500' };
    case 'no_rating':
      return { text: '暂无评分', color: 'bg-yellow-500' };
    default:
      return { text: '等待获取', color: 'bg-gray-400' };
  }
};

const getStatusText = (status: FetchStatus) => {
  switch (status) {
    case 'pending':
      return '等待获取';
    case 'loading':
      return '正在获取';
    case 'successful':
      return '获取成功';
    case 'error':
    case 'fail':
      return '获取失败';
    case 'rate_limit':
      return '访问限制';
    case 'timeout':
      return '请求超时';
    case 'not_found':
    case 'locked':
      return '未收录';
    case 'no_rating':
      return '暂无评分';
    default:
      return '未知状态';
  }
};

export function PlatformStatusBar({
  backendStatuses,
  tmdbStatus,
  traktStatus,
  onRetry
}: PlatformStatusBarProps) {
  return (
    <>
      {/* 后端平台状态卡片 */}
      {backendStatuses.map((platform) => (
        <div 
          key={platform.platform}
          className="inline-flex items-center gap-3 glass-card glass-exempt rounded-lg px-2 py-2"
        >
          <img src={platform.logo} alt={platform.platform} className="w-5 h-5" />
          <span className={`w-2 h-2 rounded-full ${getStatusColor(platform.status).color}`} />
          <span className="text-sm text-gray-700 dark:text-gray-300">{getStatusText(platform.status)}</span>
          {['error', 'fail', 'rate_limit', 'timeout', 'fetch_failed', 'parse_error', 'invalid_response', 'network_error'].includes(platform.status) && (
            <ErrorMessage
              status={platform.status}
              onRetry={() => onRetry(platform.platform)}
            />
          )}
        </div>
      ))}

      {/* TMDB 状态卡片 */}
      <div className="inline-flex items-center gap-3 glass-card glass-exempt rounded-lg px-2 py-2">
        <img src={`/logos/tmdb.png`} alt="TMDB" className="w-5 h-5" />
        <span className={`w-2 h-2 rounded-full ${getStatusColor(tmdbStatus).color}`} />
        <span className="text-sm text-black-400 dark:text-gray-300">{getStatusText(tmdbStatus)}</span>
        {tmdbStatus === 'error' && (
          <ErrorMessage
            status={tmdbStatus}
            onRetry={() => onRetry('tmdb')}
          />
        )}
      </div>

      {/* Trakt 状态卡片 */}
      <div className="inline-flex items-center gap-3 glass-card glass-exempt rounded-lg px-2 py-2">
        <img src={`/logos/trakt.png`} alt="Trakt" className="w-5 h-5" />
        <span className={`w-2 h-2 rounded-full ${getStatusColor(traktStatus).color}`} />
        <span className="text-sm text-black-400 dark:text-gray-300">{getStatusText(traktStatus)}</span>
        {traktStatus === 'error' && (
          <ErrorMessage
            status={traktStatus}
            onRetry={() => onRetry('trakt')}
          />
        )}
      </div>
    </>
  );
}
