import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { favoriteResource, unfavoriteResource } from '../../api/resources';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';

export function ResourceFavoriteIconButton({
  resourceId,
  initialFavorite = false,
  confirmBeforeUnfavorite = false,
  onFavoriteChange,
  className = '',
}: {
  resourceId: number;
  initialFavorite?: boolean;
  /** 为 true 时，从已收藏点成取消会先弹出确认 */
  confirmBeforeUnfavorite?: boolean;
  /** 收藏/取消收藏请求成功后回调（用于刷新列表等） */
  onFavoriteChange?: () => void;
  className?: string;
}) {
  const [fav, setFav] = useState(initialFavorite);
  const [loading, setLoading] = useState(false);
  const [confirmUnfavoriteOpen, setConfirmUnfavoriteOpen] = useState(false);

  useEffect(() => {
    setFav(initialFavorite);
  }, [initialFavorite, resourceId]);

  const performToggle = async (prev: boolean) => {
    setLoading(true);
    setFav(!prev);
    try {
      if (prev) await unfavoriteResource(resourceId);
      else await favoriteResource(resourceId);
      onFavoriteChange?.();
    } catch {
      setFav(prev);
    } finally {
      setLoading(false);
    }
  };

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    const prev = fav;
    if (prev && confirmBeforeUnfavorite) {
      setConfirmUnfavoriteOpen(true);
      return;
    }
    await performToggle(prev);
  };

  return (
    <>
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={[
        'inline-flex items-center justify-center rounded-full p-1',
        'hover:bg-black/5 dark:hover:bg-white/10',
        'disabled:opacity-50',
        className,
      ].join(' ')}
      aria-label={fav ? '取消收藏该资源' : '收藏该资源'}
      title={fav ? '已收藏' : '收藏'}
    >
      <Heart className="h-4 w-4" fill={fav ? 'currentColor' : 'none'} />
    </button>
    <ConfirmDialog
      open={confirmUnfavoriteOpen}
      title="取消收藏"
      message="确定取消收藏该平台资源吗？"
      confirmText="取消收藏"
      variant="danger"
      onConfirm={() => {
        setConfirmUnfavoriteOpen(false);
        void performToggle(true);
      }}
      onCancel={() => setConfirmUnfavoriteOpen(false)}
    />
    </>
  );
}

