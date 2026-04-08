// ==========================================
// 确认弹窗组件
// ==========================================
import React from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';

type ConfirmVariant = 'default' | 'danger';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <div className="text-gray-700 dark:text-gray-300 leading-relaxed">{message}</div>
      <div className="modal-actions mt-6 flex items-center justify-end gap-3">
        <Button variant="outline" onClick={onCancel}>
          {cancelText}
        </Button>
        <Button
          onClick={onConfirm}
          className={variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : undefined}
        >
          {confirmText}
        </Button>
      </div>
    </Dialog>
  );
}
