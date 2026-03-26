// ==========================================
// 导出触发按钮组件
// ==========================================
import { Download } from 'lucide-react';
import { useState, useEffect } from 'react';

interface Season {
  seasonNumber: number;
}

export type ExportLayout = 'portrait' | 'landscape';

interface ExportButtonProps {
  onExport: (layout: ExportLayout) => Promise<void>;
  seasons?: Season[];
  selectedSeason?: number;
  onSeasonChange?: (season: number | undefined) => void;
  isExporting: boolean;
  showLayoutSelect?: boolean;
}

export function ExportButton({ 
  onExport, 
  seasons = [],
  selectedSeason,
  onSeasonChange,
  isExporting,
  showLayoutSelect = true
}: ExportButtonProps) {
  const [showSeasonSelect, setShowSeasonSelect] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [selectedLayout, setSelectedLayout] = useState<ExportLayout>('portrait');

  useEffect(() => {
    if (showSeasonSelect) {
      const timer = setTimeout(() => {
        setShowSeasonSelect(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [showSeasonSelect]);

  useEffect(() => {
    if (showLayoutMenu) {
      const timer = setTimeout(() => {
        setShowLayoutMenu(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [showLayoutMenu]);

  const handleClick = async () => {
    if (showLayoutSelect && !showLayoutMenu && !showSeasonSelect) {
      setShowLayoutMenu(true);
      return;
    }
    
    if (seasons.length > 0 && !showSeasonSelect && !showLayoutMenu) {
      setShowSeasonSelect(true);
      return;
    }
    
    setShowSeasonSelect(false);
    setShowLayoutMenu(false);
    await onExport(selectedLayout);
  };

  const handleSeasonChange = async (season: number | undefined) => {
    await onSeasonChange?.(season);
    setShowSeasonSelect(false);
    
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          await onExport(selectedLayout);
          resolve(null);
        });
      });
    });
  };

  const handleLayoutChange = (layout: ExportLayout) => {
    setSelectedLayout(layout);
    setShowLayoutMenu(false);
    if (seasons.length > 0) {
      setShowSeasonSelect(true);
    } else {
      onExport(layout);
    }
  };

  return (
    <div className="fixed bottom-11 left-2 z-30">
      {showLayoutSelect && showLayoutMenu && (
        <div className="absolute bottom-full left-8 mb-2">
          <div className="glass-dropdown rounded-lg p-2 min-w-[120px]">
            <button
              onClick={() => handleLayoutChange('portrait')}
              className={`w-full text-left px-3 py-2 text-xs rounded-md mb-1 ${
                selectedLayout === 'portrait'
                  ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              disabled={isExporting}
            >
              竖版
            </button>
            <button
              onClick={() => handleLayoutChange('landscape')}
              className={`w-full text-left px-3 py-2 text-xs rounded-md ${
                selectedLayout === 'landscape'
                  ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              disabled={isExporting}
            >
              横版
            </button>
          </div>
        </div>
      )}
      
      {seasons.length > 0 && showSeasonSelect && (
        <div className="absolute bottom-full left-8 mb-2">
          <select
            value={selectedSeason || ''}
            onChange={(e) => {
              handleSeasonChange(e.target.value ? Number(e.target.value) : undefined);
            }}
            className="w-28 text-xs px-2 py-1.5 rounded-lg glass-dropdown text-gray-900 dark:text-gray-100"
            disabled={isExporting}
          >
            <option value="">整部剧集</option>
            {seasons.map((season) => (
              <option key={season.seasonNumber} value={season.seasonNumber}>
                第 {season.seasonNumber} 季
              </option>
            ))}
          </select>
        </div>
      )}

      <button
        onClick={handleClick}
        disabled={isExporting}
        className="p-2 rounded-full glass-button"
        aria-label={isExporting ? '导出中' : '导出评分卡片'}
      >
        <Download className={`w-4 h-4 text-gray-800 dark:text-white ${isExporting ? 'animate-bounce' : ''}`} />
      </button>
    </div>
  );
} 
