// ==========================================
// 通用对话框容器
// ==========================================
import React from 'react';
import { createPortal } from 'react-dom';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  if (!open) return null;

  return createPortal(
    <div className="modal-root fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 sm:p-6">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-card relative glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6 w-full max-w-[92vw] sm:max-w-2xl max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] overflow-hidden z-10">
        <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-gray-800 dark:text-gray-200">
          {title}
        </h2>
        <div className="max-h-[calc(100vh-8.5rem)] sm:max-h-[calc(100vh-10rem)] overflow-y-auto pr-1 scrollbar-gentle">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
} 
