// ==========================================
// 通用输入框组件
// ==========================================
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className = '', ...props }: InputProps) {
  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      <input
        className={`block w-full rounded-md border-2 border-gray-300 dark:border-gray-600 
          bg-white dark:bg-gray-700 shadow-sm 
          focus:border-blue-500 focus:ring-2 focus:ring-blue-500 
          text-gray-900 dark:text-gray-100 ${className}`}
        {...props}
      />
    </div>
  );
} 
