import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ResourceItem, ResourceType } from '../../api/resources';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { RESOURCE_LOGO_SRC, RESOURCE_TYPE_LABEL } from './resourceLogos';
import { ResourceFavoriteIconButton } from './ResourceFavoriteIconButton';

function openAndMaybeCopy(resource: ResourceItem) {
  const link = (resource.link || '').trim();
  if (!link) return;

  // Open first to avoid popup blocking in some browsers.
  window.open(link, '_blank', 'noreferrer');

  const code = (resource.extraction_code || '').trim();
  if (!code) return;

  navigator.clipboard
    .writeText(code)
    .then(() => toast.success('提取码已复制'))
    .catch(() => toast.error('提取码复制失败'));
}

export function ResourcePlatformRow({
  types,
  resourcesByType,
  canEditByType,
  onAddOrEdit,
  onOpen,
  onDelete,
  favoriteConfirmUnfavorite = false,
  onFavoriteChange,
}: {
  types: ResourceType[];
  resourcesByType: Partial<Record<ResourceType, ResourceItem>>;
  canEditByType?: Partial<Record<ResourceType, boolean>>;
  onAddOrEdit: (resourceType: ResourceType, existing?: ResourceItem | null) => void;
  onOpen?: (resource: ResourceItem) => void;
  onDelete?: (resource: ResourceItem) => void;
  /** 收藏列表里取消收藏前是否确认 */
  favoriteConfirmUnfavorite?: boolean;
  onFavoriteChange?: () => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<ResourceItem | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {types.map((t) => {
        const existing = resourcesByType[t] || null;
        const canEdit = !!(canEditByType && canEditByType[t]);
        const has = !!existing?.link;

        const title = has
          ? canEdit
            ? `编辑 · ${RESOURCE_TYPE_LABEL[t]}`
            : `打开 · ${RESOURCE_TYPE_LABEL[t]}${existing?.extraction_code ? '（自动复制提取码）' : ''}`
          : `添加 · ${RESOURCE_TYPE_LABEL[t]}`;

        const actionText = has ? (canEdit ? '编辑' : '已有资源') : '添加资源';

        const pillClass = [
          'group relative inline-flex items-center gap-1',
          'h-9 rounded-full border pl-2 pr-1',
          'bg-white/40 dark:bg-gray-900/30 backdrop-blur',
          has ? 'border-emerald-400/60' : 'border-gray-200/70 dark:border-gray-700/60',
          'hover:shadow-sm hover:bg-white/60 dark:hover:bg-gray-900/45',
        ].join(' ');

        return (
          <div key={t} className={pillClass}>
            <button
              type="button"
              title={title}
              className="inline-flex min-w-0 flex-1 items-center gap-2 rounded-full py-1 pl-1 pr-0 text-left"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!has) {
                  onAddOrEdit(t, null);
                  return;
                }
                if (canEdit) {
                  onAddOrEdit(t, existing);
                  return;
                }
                if (onOpen) onOpen(existing!);
                else openAndMaybeCopy(existing!);
              }}
            >
              <img
                src={RESOURCE_LOGO_SRC[t]}
                alt={RESOURCE_TYPE_LABEL[t]}
                className="h-5 w-5 flex-shrink-0 object-contain"
                loading="lazy"
              />
              <span className="text-xs whitespace-nowrap text-gray-700 dark:text-gray-200">{actionText}</span>
            </button>
            {has && existing?.id ? (
              <ResourceFavoriteIconButton
                resourceId={existing.id}
                initialFavorite={!!existing.is_favorited}
                confirmBeforeUnfavorite={favoriteConfirmUnfavorite}
                onFavoriteChange={onFavoriteChange}
                className="-mr-0.5 shrink-0"
              />
            ) : null}
            {has && canEdit && existing && onDelete ? (
              <button
                type="button"
                className="inline-flex shrink-0 items-center justify-center rounded-full p-1.5 text-red-500 hover:bg-red-500/10"
                title="删除该平台资源"
                aria-label="删除该平台资源"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPendingDelete(existing);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            ) : null}
          </div>
        );
      })}
      {onDelete ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          title="删除资源"
          message="确定删除该平台资源吗？"
          confirmText="删除"
          variant="danger"
          onConfirm={() => {
            if (pendingDelete) onDelete(pendingDelete);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
