// ==========================================
// 管理端用户管理页
// ==========================================
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '../../shared/ui/Input';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { Pagination } from '../../shared/ui/Pagination';
import {
  fetchAdminUsers,
  deleteUserByAdmin,
  banUserByAdmin,
  unbanUserByAdmin,
  setUserMemberByAdmin,
  setUsersMemberBatchByAdmin,
  type AdminUserItem,
} from '../../api/adminUsers';
import { toast } from 'sonner';
import { MEMBERSHIP_ENABLED } from '../../config/features';
import { formatChinaDateTime } from '../../shared/utils/time';

const PAGE_SIZE = 20;

export default function AdminUsersPage() {
  const [keyword, setKeyword] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [page, setPage] = useState(1);
  const [bannedFilter, setBannedFilter] = useState<'all' | 'banned' | 'normal'>('all');
  const [memberFilter, setMemberFilter] = useState<'all' | 'member' | 'normal'>('all');
  const [memberDays, setMemberDays] = useState(30);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmText: string;
    variant: 'default' | 'danger';
    onConfirm: (() => void) | null;
  }>({
    open: false,
    title: '',
    message: '',
    confirmText: '确定',
    variant: 'default',
    onConfirm: null,
  });
  const queryClient = useQueryClient();

  useEffect(() => {
    document.title = '用户管理 - 管理后台 - RateFuse';
  }, []);

  const offset = useMemo(() => (page - 1) * PAGE_SIZE, [page]);

  const effectiveMemberFilter = MEMBERSHIP_ENABLED ? memberFilter : 'all';

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-users', { keyword, offset, limit: PAGE_SIZE, banned: bannedFilter, member: effectiveMemberFilter }],
    queryFn: () => fetchAdminUsers({ q: keyword, offset, limit: PAGE_SIZE, banned: bannedFilter, member: effectiveMemberFilter }),
  });

  const total = data?.total ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    setSelectedIds([]);
  };

  const deleteMutation = useMutation({
    mutationFn: (user: AdminUserItem) => deleteUserByAdmin(user.id),
    onSuccess: () => {
      toast.success('用户已删除');
      refresh();
    },
    onError: (err: any) => {
      toast.error(err?.message || '删除失败');
    },
  });

  const banMutation = useMutation({
    mutationFn: (user: AdminUserItem) =>
      user.is_banned ? unbanUserByAdmin(user.id) : banUserByAdmin(user.id),
    onSuccess: (_, user) => {
      toast.success(user.is_banned ? '已解除封锁' : '已封锁该用户');
      refresh();
    },
    onError: (err: any) => {
      toast.error(err?.message || '操作失败');
    },
  });

  const memberMutation = useMutation({
    mutationFn: ({ user, is_member }: { user: AdminUserItem; is_member: boolean }) =>
      setUserMemberByAdmin(user.id, is_member, memberDays),
    onSuccess: (_, vars) => {
      toast.success(vars.is_member ? '已设为会员' : '已取消会员');
      refresh();
    },
    onError: (err: any) => {
      toast.error(err?.message || '操作失败');
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setKeyword(searchValue.trim());
    setSelectedIds([]);
  };

  const toggleSelectAllCurrentPage = () => {
    if (!data?.list?.length) return;
    const currentIds = data.list.map((u) => u.id);
    const allSelected = currentIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !currentIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...currentIds])));
    }
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleDelete = (user: AdminUserItem) => {
    setConfirmState({
      open: true,
      title: '删除用户',
      message: `确定要删除用户「${user.username}」吗？此操作不可恢复。`,
      confirmText: '删除',
      variant: 'danger',
      onConfirm: () => deleteMutation.mutate(user),
    });
  };

  const handleBanToggle = (user: AdminUserItem) => {
    const action = user.is_banned ? '解除封锁' : '封锁';
    setConfirmState({
      open: true,
      title: `${action}用户`,
      message: `确定要${action}用户「${user.username}」吗？`,
      confirmText: '确定',
      variant: 'default',
      onConfirm: () => banMutation.mutate(user),
    });
  };

  const selectedUsers = (data?.list || []).filter((u) => selectedIds.includes(u.id));
  const hasSelection = selectedUsers.length > 0;

  const handleBatchDelete = () => {
    if (!hasSelection) return;
    const names = selectedUsers.map((u) => u.username || u.email || u.id).join('、');
    setConfirmState({
      open: true,
      title: '批量删除用户',
      message: `确定要删除选中的 ${selectedUsers.length} 个用户吗？${names ? `（${names}）` : ''} 此操作不可恢复。`,
      confirmText: '删除',
      variant: 'danger',
      onConfirm: () => {
        (async () => {
          for (const user of selectedUsers) {
            try {
              await deleteUserByAdmin(user.id);
            } catch (e: any) {
              toast.error(e?.message || `删除用户 ${user.username} 失败`);
              return;
            }
          }
          toast.success('已批量删除选中用户');
          refresh();
        })();
      },
    });
  };

  const handleBatchBan = (target: 'ban' | 'unban') => {
    if (!hasSelection) return;
    const usersToHandle =
      target === 'ban'
        ? selectedUsers.filter((u) => !u.is_banned)
        : selectedUsers.filter((u) => u.is_banned);
    if (!usersToHandle.length) return;
    const actionText = target === 'ban' ? '封锁' : '解除封锁';
    const names = usersToHandle.map((u) => u.username || u.email || u.id).join('、');
    setConfirmState({
      open: true,
      title: `批量${actionText}用户`,
      message: `确定要对选中的 ${usersToHandle.length} 个用户执行「${actionText}」操作吗？${names ? `（${names}）` : ''}`,
      confirmText: '确定',
      variant: 'default',
      onConfirm: () => {
        (async () => {
          try {
            for (const user of usersToHandle) {
              if (target === 'ban') {
                await banUserByAdmin(user.id);
              } else {
                await unbanUserByAdmin(user.id);
              }
            }
            toast.success(`已批量${actionText}选中用户`);
            refresh();
          } catch (e: any) {
            toast.error(e?.message || `批量${actionText}失败`);
          }
        })();
      },
    });
  };

  const handleBatchMember = (target: 'member' | 'normal') => {
    if (!hasSelection) return;
    const usersToHandle =
      target === 'member'
        ? selectedUsers.filter((u) => !u.is_member)
        : selectedUsers.filter((u) => u.is_member);
    if (!usersToHandle.length) return;
    const isMember = target === 'member';
    setConfirmState({
      open: true,
      title: isMember ? '批量设为会员' : '批量取消会员',
      message: `确定对选中的 ${usersToHandle.length} 个用户执行该操作吗？`,
      confirmText: '确定',
      variant: 'default',
      onConfirm: () => {
        (async () => {
          try {
            await setUsersMemberBatchByAdmin(usersToHandle.map((u) => u.id), isMember, memberDays);
            toast.success(isMember ? '已批量设为会员' : '已批量取消会员');
            refresh();
          } catch (e: any) {
            toast.error(e?.message || '批量操作失败');
          }
        })();
      },
    });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">
            用户管理
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            支持按昵称搜索、封禁状态筛选，并进行单个或批量操作
          </p>
        </div>
        <form
          onSubmit={handleSearch}
          className="w-full sm:w-auto flex flex-col sm:flex-row gap-3 items-stretch sm:items-end"
        >
          <div className="sm:w-72">
            <Input
              label="搜索用户（昵称）"
              placeholder="输入用户昵称关键字"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              封禁状态
            </label>
            <select
              value={bannedFilter}
              onChange={(e) => {
                const v = e.target.value as 'all' | 'banned' | 'normal';
                setBannedFilter(v);
                setPage(1);
                setSelectedIds([]);
              }}
              className="block w-40 rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 text-sm"
            >
              <option value="all">全部</option>
              <option value="normal">仅正常</option>
              <option value="banned">仅已封锁</option>
            </select>
          </div>
          {MEMBERSHIP_ENABLED && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  会员状态
                </label>
                <select
                  value={memberFilter}
                  onChange={(e) => {
                    const v = e.target.value as 'all' | 'member' | 'normal';
                    setMemberFilter(v);
                    setPage(1);
                    setSelectedIds([]);
                  }}
                  className="block w-40 rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 text-sm"
                >
                  <option value="all">全部</option>
                  <option value="normal">仅普通</option>
                  <option value="member">仅会员</option>
                </select>
              </div>
              <div className="w-24">
                <Input
                  label="会员天数"
                  value={String(memberDays)}
                  onChange={(e) => setMemberDays(Math.max(1, Number(e.target.value) || 30))}
                />
              </div>
            </>
          )}
          <Button
            type="submit"
            className="h-10 sm:h-11 whitespace-nowrap no-hover-scale"
            disabled={isFetching}
          >
            {isFetching ? '搜索中...' : '搜索'}
          </Button>
        </form>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
        <div>
          已选择 <span className="font-semibold">{selectedIds.length}</span> 个用户
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="no-hover-scale px-2 py-1 text-xs"
            disabled={!hasSelection || deleteMutation.isPending || banMutation.isPending}
            onClick={() => handleBatchBan('ban')}
          >
            批量封锁
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="no-hover-scale px-2 py-1 text-xs"
            disabled={!hasSelection || deleteMutation.isPending || banMutation.isPending}
            onClick={() => handleBatchBan('unban')}
          >
            批量解除封锁
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="no-hover-scale px-2 py-1 text-xs"
            disabled={!hasSelection || deleteMutation.isPending}
            onClick={handleBatchDelete}
          >
            批量删除
          </Button>
          {MEMBERSHIP_ENABLED && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="no-hover-scale px-2 py-1 text-xs"
                disabled={!hasSelection || memberMutation.isPending}
                onClick={() => handleBatchMember('member')}
              >
                批量设会员
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="no-hover-scale px-2 py-1 text-xs"
                disabled={!hasSelection || memberMutation.isPending}
                onClick={() => handleBatchMember('normal')}
              >
                批量取消会员
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/80">
            <tr>
              <th className="px-3 py-3 text-left font-medium text-gray-500 dark:text-gray-400 w-10">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 dark:border-gray-600"
                  checked={
                    !!data?.list?.length &&
                    data.list.every((u) => selectedIds.includes(u.id))
                  }
                  onChange={toggleSelectAllCurrentPage}
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                用户
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                邮箱
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                权限
              </th>
              {MEMBERSHIP_ENABLED && (
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                  会员
                </th>
              )}
              <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                状态
              </th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={MEMBERSHIP_ENABLED ? 7 : 6}
                  className="px-4 py-10 text-center text-gray-500 dark:text-gray-400"
                >
                  加载中...
                </td>
              </tr>
            ) : (data?.list?.length ?? 0) === 0 ? (
              <tr>
                <td
                  colSpan={MEMBERSHIP_ENABLED ? 7 : 6}
                  className="px-4 py-10 text-center text-gray-500 dark:text-gray-400"
                >
                  暂无用户数据
                </td>
              </tr>
            ) : (
              data!.list.map((user) => (
                <tr
                  key={user.id}
                  className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50/80 dark:hover:bg-gray-800/60"
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 dark:border-gray-600"
                      checked={selectedIds.includes(user.id)}
                      onChange={() => toggleSelectOne(user.id)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={user.avatar || ''}
                        alt={user.username}
                        className="w-9 h-9 rounded-full object-cover bg-gray-100 dark:bg-gray-800 flex-shrink-0"
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          const img = e.currentTarget;
                          try {
                            const raw = user.avatar;
                            if (!raw) {
                              img.style.visibility = 'hidden';
                              return;
                            }
                            if (img.dataset.retryAvatar === '3') {
                              img.style.visibility = 'hidden';
                              return;
                            }
                            img.dataset.retryAvatar = '3';
                            const hasQuery = raw.includes('?');
                            img.src = `${raw}${hasQuery ? '&' : '?'}cb=${Date.now()}`;
                          } catch {
                          }
                        }}
                        onLoad={(e) => {
                          e.currentTarget.style.visibility = 'visible';
                        }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white truncate">
                          {user.username || '（未设置昵称）'}
                        </div>
                        <div className="text-xs text-gray-400">
                          ID: {user.id}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                    {user.email}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
                      {user.is_admin ? '管理员' : '普通用户'}
                    </span>
                  </td>
                  {MEMBERSHIP_ENABLED && (
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                        user.is_member
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                      }`}>
                        {user.is_member ? '会员' : '普通'}
                      </span>
                      {user.member_expired_at ? (
                        <div className="text-[11px] text-gray-500 mt-1">到期：{formatChinaDateTime(user.member_expired_at)}</div>
                      ) : null}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                        user.is_banned
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      }`}
                    >
                      {user.is_banned ? '已封锁' : '正常'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="no-hover-scale px-2 py-1 text-xs"
                        onClick={() => handleBanToggle(user)}
                        disabled={banMutation.isPending || deleteMutation.isPending}
                      >
                        {user.is_banned ? '解除' : '封锁'}
                      </Button>
                      {MEMBERSHIP_ENABLED && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="no-hover-scale px-2 py-1 text-xs"
                          onClick={() => memberMutation.mutate({ user, is_member: !user.is_member })}
                          disabled={memberMutation.isPending || deleteMutation.isPending}
                        >
                          {user.is_member ? '取消会员' : '设为会员'}
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        className="no-hover-scale px-2 py-1 text-xs"
                        onClick={() => handleDelete(user)}
                        disabled={deleteMutation.isPending}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText="取消"
        variant={confirmState.variant}
        onCancel={() =>
          setConfirmState((prev) => ({ ...prev, open: false, onConfirm: null }))
        }
        onConfirm={() => {
          const action = confirmState.onConfirm;
          setConfirmState((prev) => ({ ...prev, open: false, onConfirm: null }));
          action?.();
        }}
      />
    </div>
  );
}
