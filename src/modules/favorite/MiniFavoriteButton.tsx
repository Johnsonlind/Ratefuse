// ==========================================
// 轻量收藏按钮组件
// ==========================================
import { Star } from 'lucide-react';
import { AuthModal } from '../auth/AuthModal';
import { Dialog } from '../../shared/ui/Dialog';
import { Input } from '../../shared/ui/Input';
import { Textarea } from '../../shared/ui/Textarea';
import { Button } from '../../shared/ui/Button';
import { Switch } from '../../shared/ui/Switch';
import { useFavorite } from '../../modules/favorite/useFavorite';

interface MiniFavoriteButtonProps {
  mediaId: string;
  mediaType: string;
  title: string;
  poster: string;
  year?: string;
  overview?: string;
  className?: string;
}

export function MiniFavoriteButton({ 
  mediaId, 
  mediaType, 
  title, 
  poster, 
  year, 
  overview = '',
  className = ''
}: MiniFavoriteButtonProps) {
  const {
    isFavorited,
    isLoading,
    showDialog,
    showAuthModal,
    lists,
    selectedList,
    note,
    sortOrderInput,
    showCreateList,
    newList,
    setShowDialog,
    setShowAuthModal,
    setSelectedList,
    setNote,
    setSortOrderInput,
    setShowCreateList,
    setNewList,
    handleCreateList,
    handleFavorite,
    handleButtonClick,
    isListsLoading,
    listsLoadError,
    reloadLists,
  } = useFavorite({
    mediaId,
    mediaType,
    title,
    poster,
    year,
    overview,
    useReactQuery: true
  });

  return (
    <>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleButtonClick(e);
        }}
        disabled={isLoading}
        className={`${className || 'p-1.5'} rounded-full glass-button transition-all z-10
          ${isFavorited 
            ? '!bg-yellow-500/80 hover:!bg-yellow-500' 
            : ''
          }
        `}
        aria-label={isFavorited ? '已收藏' : '收藏'}
        title={isFavorited ? '已收藏' : '收藏'}
      >
        <Star 
          className={`w-3 h-3 ${
            isFavorited 
              ? 'text-white' 
              : 'text-gray-800 dark:text-white'
          }`} 
          fill={isFavorited ? 'currentColor' : 'none'}
        />
      </button>

      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
      />

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
                onChange={(e) => setNewList({...newList, name: e.target.value})}
              />
              <Textarea
                label="列表描述（可选）"
                value={newList.description}
                onChange={(e) => setNewList({...newList, description: e.target.value})}
              />
              <div className="flex items-center gap-2">
                <Switch
                  checked={newList.is_public}
                  onCheckedChange={(checked) => setNewList({...newList, is_public: checked})}
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
              {isListsLoading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">收藏列表加载中...</div>
              ) : listsLoadError ? (
                <div className="space-y-2">
                  <div className="text-sm text-gray-500 dark:text-gray-400">{listsLoadError}</div>
                  <Button variant="outline" onClick={() => { void reloadLists(); }}>
                    重新加载
                  </Button>
                </div>
              ) : (
                <select
                  value={selectedList || ''}
                  onChange={(e) => setSelectedList(Number(e.target.value))}
                  className="w-full rounded-md border-2 border-gray-300 dark:border-gray-600 
                    bg-white dark:bg-gray-700 
                    text-gray-900 dark:text-gray-100"
                >
                  {lists.map(list => (
                    <option key={list.id} value={list.id}>{list.name}</option>
                  ))}
                </select>
              )}
              <Textarea
                label="添加备注（可选）"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="添加你的观影感受..."
              />
              <Input
                label="排序序号（可选，1 开始）"
                value={sortOrderInput}
                onChange={(e) => setSortOrderInput(e.target.value)}
                placeholder="例如：1"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowDialog(false)}>
                  取消
                </Button>
                <Button onClick={handleFavorite} disabled={isLoading || isListsLoading || !!listsLoadError || !selectedList}>
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
