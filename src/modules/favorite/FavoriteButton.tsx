// ==========================================
// 收藏操作按钮组件
// ==========================================
import { Star } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Dialog } from '../../shared/ui/Dialog';
import { Input } from '../../shared/ui/Input';
import { Textarea } from '../../shared/ui/Textarea';
import { Button } from '../../shared/ui/Button';
import { Switch } from '../../shared/ui/Switch';
import { useFavorite } from '../../modules/favorite/useFavorite';

interface FavoriteButtonProps {
  mediaId: string;
  mediaType: string;
  title: string;
  poster: string;
  year: string;
  overview: string;
}

export function FavoriteButton({ mediaId, mediaType, title, poster, year, overview }: FavoriteButtonProps) {
  const { user } = useAuth();
  const {
    isFavorited,
    isLoading,
    showDialog,
    lists,
    selectedList,
    note,
    sortOrderInput,
    showCreateList,
    newList,
    setShowDialog,
    setSelectedList,
    setNote,
    setSortOrderInput,
    setShowCreateList,
    setNewList,
    handleCreateList,
    handleFavorite
  } = useFavorite({
    mediaId,
    mediaType,
    title,
    poster,
    year,
    overview,
    useReactQuery: false
  });

  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setShowDialog(true)}
        disabled={isLoading}
        className={`fixed bottom-20 left-2 z-30 p-2 rounded-full glass-button transition-all
          ${isFavorited 
            ? '!bg-yellow-500/80 hover:!bg-yellow-500' 
            : ''
          }`}
        aria-label={isFavorited ? '修改收藏' : '收藏'}
      >
        <Star 
          className={`w-4 h-4 ${
            isFavorited 
              ? 'text-white' 
              : 'text-gray-800 dark:text-white'
          }`} 
          fill={isFavorited ? 'currentColor' : 'none'}
        />
      </button>

      <Dialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        title={isFavorited ? "修改收藏" : "添加到收藏"}
      >
        <div className="space-y-4">
          {showCreateList ? (
            <div className="space-y-4">
              <Input
                label="列表名称"
                value={newList.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewList({...newList, name: e.target.value})}
              />
              <Textarea
                label="列表描述（可选）"
                value={newList.description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewList({...newList, description: e.target.value})}
              />
              <div className="flex items-center gap-2">
                <Switch
                  checked={newList.is_public}
                  onCheckedChange={(checked: boolean) => setNewList({...newList, is_public: checked})}
                />
                <span>公开列表</span>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleCreateList}>创建</Button>
                <Button variant="outline" onClick={() => setShowCreateList(false)}>取消</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <label className="block text-sm font-medium">选择收藏列表</label>
                <Button variant="outline" onClick={() => setShowCreateList(true)}>
                  创建新列表
                </Button>
              </div>
              <select
                value={selectedList || ''}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedList(Number(e.target.value))}
                className="w-full rounded-md glass-dropdown text-gray-900 dark:text-gray-100 px-3 py-2"
              >
                {lists.map((list: { id: number; name: string }) => (
                  <option key={list.id} value={list.id}>{list.name}</option>
                ))}
              </select>
              <Textarea
                label="添加备注（可选）"
                value={note}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
                placeholder="添加你的观影感受..."
              />
              <Input
                label="排序序号（可选，1 开始）"
                value={sortOrderInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSortOrderInput(e.target.value)}
                placeholder="例如：1"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowDialog(false)}>
                  取消
                </Button>
                <Button onClick={handleFavorite} disabled={isLoading}>
                  {isLoading ? '保存中...' : '保存'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
} 
