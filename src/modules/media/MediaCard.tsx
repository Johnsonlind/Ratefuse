// ==========================================
// 媒体卡片组件
// ==========================================
import { Link } from 'react-router-dom';
import type { Media } from '../../shared/types/media';
import { MiniFavoriteButton } from '../favorite/MiniFavoriteButton';
import { useAuth } from '../auth/AuthContext';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMediaResources, RESOURCE_TYPES, submitResource, type ResourceType } from '../../api/resources';
import { ResourcePlatformRow } from '../resources/ResourcePlatformRow';
import { ResourceLinkDialog } from '../resources/ResourceLinkDialog';
import { hasMemberPrivileges } from '../../shared/utils/membershipAccess';

interface MediaCardProps {
  item: Media;
}

export function MediaCard({ item }: MediaCardProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const linkPath = item.type === 'movie' ? `/movie/${item.id}` : `/tv/${item.id}`;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<ResourceType>('baidu');

  const { data: resourcesData } = useQuery({
    queryKey: ['resources', item.type, String(item.id)],
    queryFn: () => fetchMediaResources(item.type, item.id),
    enabled: hasMemberPrivileges(user),
    staleTime: 30 * 1000,
  });

  const resourcesByType = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of resourcesData?.resources || []) map[r.resource_type] = r;
    return map as any;
  }, [resourcesData?.resources]);

  return (
    <div className="group block">
      <div className="glass-card rounded-lg overflow-hidden relative">
        <Link to={linkPath}>
          <div className="flex items-start">
            {/* 海报 */}
            <div className="w-16 sm:w-20 lg:w-24 flex-shrink-0 overflow-hidden bg-gray-900/10 dark:bg-white/5">
              <div className="relative aspect-[2/3] w-full">
                <img
                  src={item.poster}
                  alt={item.title}
                  crossOrigin="anonymous"
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            </div>

            {/* 内容 */}
            <div className="flex-1 min-w-0 p-2 sm:p-3 flex flex-col justify-start gap-2">
              <h3 className="font-medium text-sm sm:text-base lg:text-lg line-clamp-2">
                {item.title}
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 mt-1">{item.year}</p>
              {hasMemberPrivileges(user) ? (
                <div onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}>
                  <ResourcePlatformRow
                    types={RESOURCE_TYPES}
                    resourcesByType={resourcesByType}
                    onAddOrEdit={(t) => {
                      setDialogType(t);
                      setDialogOpen(true);
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </Link>
        
        {/* 收藏按钮 */}
        <div className="absolute bottom-2 right-2 z-20">
          <MiniFavoriteButton
            mediaId={item.id.toString()}
            mediaType={item.type}
            title={item.title}
            poster={item.poster}
            year={item.year.toString()}
            overview={item.overview}
          />
        </div>
      </div>

      {hasMemberPrivileges(user) ? (
        <ResourceLinkDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          resourceType={dialogType}
          existing={null}
          onSubmit={async ({ link, extraction_code }) => {
            await submitResource({
              media_type: item.type,
              tmdb_id: Number(item.id),
              media_title: item.title,
              media_year: Number(item.year) || null,
              resource_type: dialogType,
              link,
              extraction_code,
              agreement_confirmed: true,
            });
            queryClient.invalidateQueries({ queryKey: ['resources', item.type, String(item.id)] });
          }}
        />
      ) : null}
    </div>
  );
}
