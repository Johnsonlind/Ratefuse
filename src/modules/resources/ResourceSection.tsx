// ==========================================
// 资源区域组件
// ==========================================
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMediaResources, RESOURCE_TYPES, submitResource, updateResource, type ResourceItem, type ResourceType } from '../../api/resources';
import { useAuth } from '../auth/AuthContext';
import { MemberOnlyPlaceholder } from './MemberOnlyPlaceholder';
import { ResourceLinkDialog } from './ResourceLinkDialog';
import { ResourcePlatformRow } from './ResourcePlatformRow';
import { MEMBERSHIP_ENABLED } from '../../config/features';
import { hasMemberPrivileges } from '../../shared/utils/membershipAccess';

export function ResourceSection({ mediaType, tmdbId, title, year }: { mediaType: 'movie' | 'tv'; tmdbId: string; title: string; year?: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeType, setActiveType] = useState<ResourceType>('baidu');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogExisting, setDialogExisting] = useState<ResourceItem | null>(null);

  const { data } = useQuery({
    queryKey: ['resources', mediaType, tmdbId],
    queryFn: () => fetchMediaResources(mediaType, tmdbId),
    enabled: hasMemberPrivileges(user),
  });

  if (!MEMBERSHIP_ENABLED) return null;

  if (!hasMemberPrivileges(user)) {
    return (
      <MemberOnlyPlaceholder text={!user ? '登录后查看资源区' : '会员可见资源区'} />
    );
  }

  const resourcesByType = useMemo(() => {
    const map: Partial<Record<ResourceType, ResourceItem>> = {};
    for (const r of data?.resources || []) {
      map[r.resource_type] = r;
    }
    return map;
  }, [data?.resources]);

  const canEditByType = useMemo(() => {
    const map: Partial<Record<ResourceType, boolean>> = {};
    for (const r of data?.resources || []) {
      map[r.resource_type] = !!(r as any).can_edit;
    }
    return map;
  }, [data?.resources]);

  return (
    <section className="glass-card rounded-xl p-4 mb-6">
      <div className="mb-2 text-xs text-gray-500">本站仅提供链接跳转，不存储任何资源。如有侵权请联系删除。</div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <ResourcePlatformRow
          types={RESOURCE_TYPES}
          resourcesByType={resourcesByType}
          canEditByType={canEditByType}
          onAddOrEdit={(t, existing) => {
            setActiveType(t);
            setDialogExisting(existing || null);
            setDialogOpen(true);
          }}
        />
      </div>

      <ResourceLinkDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        resourceType={activeType}
        existing={dialogExisting}
        onSubmit={async ({ link, extraction_code }) => {
          if (dialogExisting?.id) {
            await updateResource(dialogExisting.id, { link, extraction_code });
          } else {
            await submitResource({
              media_type: mediaType,
              tmdb_id: Number(tmdbId),
              media_title: title,
              media_year: year,
              resource_type: activeType,
              link,
              extraction_code,
              agreement_confirmed: true,
            });
          }
          queryClient.invalidateQueries({ queryKey: ['resources', mediaType, tmdbId] });
        }}
      />
    </section>
  );
}
