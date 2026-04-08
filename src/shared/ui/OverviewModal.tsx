// ==========================================
// 概览弹窗组件
// ==========================================
import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface OverviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  overview: string;
  title: string;
}

export function OverviewModal({ isOpen, onClose, overview, title }: OverviewModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', handleEscape);
      
      return () => {
        document.body.style.overflow = '';
        window.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
      className="modal-root fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="modal-card relative bg-white dark:bg-gray-800 w-full max-w-lg rounded-lg shadow-xl">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          <p className="text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-line">
            {overview}
          </p>
        </div>
      </div>
    </div>
  );
}
