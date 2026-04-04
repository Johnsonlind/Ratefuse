// ==========================================
// 错误提示组件
// ==========================================
import type { FetchStatus } from '../../shared/types/status';

interface ErrorMessageProps {
  status: FetchStatus;
  errorDetail?: string;
  onRetry?: () => void;
  retryCount?: number;
}

export function ErrorMessage({ 
  status,
  errorDetail, 
  onRetry,
  retryCount = 0
}: ErrorMessageProps) {
  const shouldShowRetry = 
    (['not_found', 'no_rating'].includes(status) && retryCount < 3) ||
    ['rate_limit', 'timeout', 'fail', 'error'].includes(status);

  return (
    <div className="flex flex-col items-center justify-center py-0 text-center">
      {errorDetail && (
        <div className="text-gray-400 text-sm mb-4">{errorDetail}</div>
      )}
      {shouldShowRetry && onRetry && (
        <button
          onClick={onRetry}
          className="text-blue-500 text-sm mb-0 rounded-lg hover:bg-yellow-600 transition-colors"
        >
          重试
        </button>
      )}
    </div>
  );
}

export default ErrorMessage; 
