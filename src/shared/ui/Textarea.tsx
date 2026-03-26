// ==========================================
// 多行输入组件
// ==========================================
import React from 'react';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function Textarea({ label, className = '', ...props }: TextareaProps) {
  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      <textarea
        className={`block w-full rounded-md border-2 border-gray-300 dark:border-gray-600 
          bg-white dark:bg-gray-700 shadow-sm 
          focus:border-blue-500 focus:ring-2 focus:ring-blue-500 
          text-gray-900 dark:text-gray-100 ${className}`}
        {...props}
      />
    </div>
  );
} 
