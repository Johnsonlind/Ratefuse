import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAdminResources, reviewAdminResource, type AdminResourceItem } from '../../api/adminResources';
import { Button } from '../../shared/ui/Button';
import { Input } from '../../shared/ui/Input';
import { toast } from 'sonner';

export default function AdminResourcesPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [keyword, setKeyword] = useState('');
  const [rejectReason, setRejectReason] = useState<Record<number, string>>({});

  useEffect(() => {
    document.title = '资源审核 - 管理后台 - RateFuse';
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-resources', status],
    queryFn: () => fetchAdminResources(status),
  });

  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return data || [];
    return (data || []).filter((x) => {
      const hay = `${x.media_title} ${x.tmdb_id} ${x.resource_type} ${x.link}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, keyword]);

  const reviewMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: number; action: 'approve' | 'reject'; reason?: string }) =>
      reviewAdminResource(id, action, reason),
    onSuccess: (_, vars) => {
      toast.success(vars.action === 'approve' ? '已通过' : '已驳回');
      queryClient.invalidateQueries({ queryKey: ['admin-resources'] });
    },
    onError: (e: any) => {
      toast.error(e?.message || '审核失败');
    },
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">资源审核</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">审核用户提交的网盘/磁力资源</p>
        </div>
        <div className="ml-auto flex gap-2">
          <select
            className="rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
          >
            <option value="all">全部</option>
            <option value="pending">待审核</option>
            <option value="approved">已通过</option>
            <option value="rejected">已驳回</option>
          </select>
          <div className="w-72">
            <Input placeholder="按标题/平台/链接筛选" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/80">
            <tr>
              <th className="px-4 py-3 text-left">影视</th>
              <th className="px-4 py-3 text-left">平台</th>
              <th className="px-4 py-3 text-left">链接/提取码</th>
              <th className="px-4 py-3 text-left">状态</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td className="px-4 py-8 text-center text-gray-500" colSpan={5}>加载中...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-4 py-8 text-center text-gray-500" colSpan={5}>暂无数据</td></tr>
            ) : (
              rows.map((r: AdminResourceItem) => (
                <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{r.media_title}</div>
                    <div className="text-xs text-gray-500">{r.media_type} · TMDB {r.tmdb_id}</div>
                  </td>
                  <td className="px-4 py-3">{r.resource_type}</td>
                  <td className="px-4 py-3">
                    <a href={r.link} target="_blank" rel="noreferrer" className="text-blue-500 break-all">{r.link}</a>
                    {r.extraction_code ? <div className="text-xs text-gray-500 mt-1">提取码：{r.extraction_code}</div> : null}
                  </td>
                  <td className="px-4 py-3">{r.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="no-hover-scale px-2 py-1 text-xs"
                          disabled={reviewMutation.isPending || r.status === 'approved'}
                          onClick={() => reviewMutation.mutate({ id: r.id, action: 'approve' })}
                        >
                          通过
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="no-hover-scale px-2 py-1 text-xs"
                          disabled={reviewMutation.isPending || r.status === 'rejected'}
                          onClick={() =>
                            reviewMutation.mutate({ id: r.id, action: 'reject', reason: rejectReason[r.id] || undefined })
                          }
                        >
                          驳回
                        </Button>
                      </div>
                      <input
                        className="w-56 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs"
                        placeholder="驳回原因（可选）"
                        value={rejectReason[r.id] || ''}
                        onChange={(e) => setRejectReason((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

