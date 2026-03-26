// ==========================================
// 标签切换组件
// ==========================================
import type { ReactNode } from 'react';
import { cn } from '../../shared/utils/utils';

export interface CardTabItem {
  id: string;
  label: ReactNode;
}

interface CardTabsProps {
  tabs: CardTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

export function CardTabs({ tabs, activeId, onChange, className }: CardTabsProps) {
  if (!tabs || tabs.length === 0) return null;

  return (
    <div
      className={cn(
        'overflow-x-auto px-1 pt-1 pb-1 scrollbar-gentle',
        className,
      )}
    >
      <div className="flex gap-2 border-b-2 border-gray-300 dark:border-gray-700 min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                'flex-shrink-0 px-3 py-2 sm:px-4 text-sm font-medium rounded-t-xl transition-colors duration-150',
                'border border-b-0',
              isActive
                ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm -mb-0.5 border-gray-300 dark:border-gray-600 border-b-white dark:border-b-gray-900'
                : 'bg-gray-200 dark:bg-gray-800/80 text-gray-700 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-300 dark:hover:bg-gray-700/80 border-gray-300 dark:border-gray-700',
            )}
          >
            {tab.label}
          </button>
        );
      })}
      </div>
    </div>
  );
}

