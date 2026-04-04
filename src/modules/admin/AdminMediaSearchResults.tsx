// ==========================================
// 管理端搜索结果组件
// ==========================================
export interface AdminMediaItem {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  poster: string;
  year?: number;
}

interface AdminMediaSearchResultsProps {
  items: AdminMediaItem[];
  selectedItem: AdminMediaItem | null;
  onSelect: (item: AdminMediaItem) => void;
  onClearSelection?: () => void;
  emptyMessage?: string;
}

export function AdminMediaSearchResults({
  items,
  selectedItem,
  onSelect,
  onClearSelection,
  emptyMessage,
}: AdminMediaSearchResultsProps) {
  if (selectedItem) {
    return (
      <div className="flex flex-wrap gap-2">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800"
        >
          {selectedItem.poster && (
            <img src={selectedItem.poster} alt="" className="w-8 h-12 object-cover rounded" />
          )}
          <span>
            {selectedItem.title} {selectedItem.year != null && `(${selectedItem.year})`}
          </span>
          {onClearSelection && (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-red-500 hover:text-red-600 ml-1"
            >
              ×
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto scrollbar-gentle py-2 px-1">
      {items.length === 0 ? (
        emptyMessage ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">{emptyMessage}</div>
        ) : null
      ) : (
        items.map((item) => (
          <button
            key={`${item.type}-${item.id}`}
            type="button"
            onClick={() => onSelect(item)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 hover:bg-blue-50/70 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-700 transition-colors duration-200 text-left"
          >
            {item.poster && (
              <img src={item.poster} alt="" className="w-8 h-12 object-cover rounded" />
            )}
            <div className="flex flex-col items-start">
              <span className="font-medium text-sm">{item.title}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {item.type === 'movie' ? '电影' : '剧集'}
                {item.year != null ? ` · ${item.year}` : ''}
              </span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
