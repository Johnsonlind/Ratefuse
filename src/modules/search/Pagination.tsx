// ==========================================
// 分页组件
// ==========================================
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  const [pageInput, setPageInput] = useState(String(currentPage));

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const goToPage = () => {
    const parsedPage = Number.parseInt(pageInput, 10);
    if (Number.isNaN(parsedPage)) return;

    const targetPage = Math.min(Math.max(parsedPage, 1), totalPages);
    if (targetPage !== currentPage) {
      onPageChange(targetPage);
    } else {
      setPageInput(String(targetPage));
    }
  };

  return (
    <div className="flex items-center justify-center gap-2 mt-6 sm:mt-8 flex-wrap">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="p-2 rounded-lg glass-card disabled:opacity-50 disabled:hover:scale-100 touch-manipulation"
      >
        <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>
      
      <span className="px-3 py-1 sm:px-4 sm:py-2 text-sm sm:text-base">
        {currentPage} / {totalPages}
      </span>
      
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="p-2 rounded-lg glass-card disabled:opacity-50 disabled:hover:scale-100 touch-manipulation"
      >
        <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      <div className="flex items-center gap-2 ml-1 sm:ml-2">
        <input
          type="number"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') goToPage();
          }}
          className="w-20 px-2 py-1 rounded-lg glass-card text-sm sm:text-base outline-none focus:ring-2 focus:ring-cyan-500/50"
          aria-label="输入页码"
        />
        <button
          onClick={goToPage}
          className="px-3 py-1 sm:px-4 sm:py-2 rounded-lg glass-card text-sm sm:text-base touch-manipulation"
        >
          跳转
        </button>
      </div>
    </div>
  );
}
