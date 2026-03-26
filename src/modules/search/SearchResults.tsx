// ==========================================
// 搜索结果列表组件
// ==========================================
import { MediaCard } from '../media/MediaCard';
import { Pagination } from './Pagination';
import type { Media } from '../../shared/types/media';

interface SearchResultsProps {
  items: Media[];
  totalPages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  title?: string;
}

export function SearchResults({ 
  items, 
  totalPages,
  currentPage,
  onPageChange,
  title 
}: SearchResultsProps) {
  return (
    <div>
      {title && (
        <h2 className="text-xl sm:text-2xl font-bold mb-4 hidden lg:block dark:text-white">{title}</h2>
      )}
      <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:gap-y-3 lg:space-y-0">
        {items.map((item) => (
          <MediaCard key={item.id} item={item} />
        ))}
      </div>
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}
