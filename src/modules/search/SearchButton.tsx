// ==========================================
// 搜索页入口按钮组件
// ==========================================
import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { searchByImdbId } from '../../api/tmdb';
import { createPortal } from 'react-dom';

export function SearchButton() {
  const [showSearch, setShowSearch] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const clearSearchFlag = !!(location.state && typeof location.state === 'object' && (location.state as any).clearSearch);

  const handleSearch = async (query: string) => {
    if (query.trim()) {
      const imdbIdMatch = query.match(/^(?:tt)?(\d{7,8})$/);
      
      if (imdbIdMatch) {
        const results = await searchByImdbId(imdbIdMatch[0]);
        if (results.movies.length > 0) {
          navigate(`/movie/${results.movies[0].id}`);
          return;
        } else if (results.tvShows.length > 0) {
          navigate(`/tv/${results.tvShows[0].id}`);
          return;
        }
      }
      
      navigate('/', { state: { searchQuery: query.trim() } });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowSearch(false);
    } else if (e.key === 'Enter') {
      const input = e.currentTarget;
      handleSearch(input.value);
      setShowSearch(false);
    }
  };

  useEffect(() => {
    if (showSearch) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showSearch]);

  useEffect(() => {
    const handler = () => setShowSearch(false);
    window.addEventListener('ratefuse:closeSearchOverlay', handler);
    return () => window.removeEventListener('ratefuse:closeSearchOverlay', handler);
  }, []);

  useEffect(() => {
    if (showSearch) setShowSearch(false);
  }, [location.key]);

  useEffect(() => {
    if (clearSearchFlag && showSearch) setShowSearch(false);
  }, [clearSearchFlag, showSearch]);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowSearch(true)}
        className="w-7 h-7 flex items-center justify-center rounded-full glass-button transition-all duration-200 hover:scale-110 pointer-events-auto"
        aria-label="搜索"
        aria-haspopup="dialog"
        aria-expanded={showSearch}
      >
        <Search className="w-5 h-5 text-gray-800 dark:text-white" />
      </button>

      {showSearch && createPortal(
        <div
          className="fixed inset-0 z-[10001] flex items-start justify-center bg-black/60 backdrop-blur-sm pt-20"
          role="dialog"
          aria-modal="true"
          aria-label="搜索"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowSearch(false);
          }}
        >
          <div className="w-full max-w-2xl mx-4">
            <input
              type="text"
              autoFocus
              placeholder="搜索电影或电视剧..."
              className="w-full px-2 py-1.5 text-lg rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              aria-label="搜索输入框"
            />
          </div>
          <div 
            className="absolute inset-0 -z-10" 
            onClick={() => setShowSearch(false)}
          />
        </div>,
        document.body
      )}
    </>
  );
} 
