// ==========================================
// 通用按钮组件
// ==========================================
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export function Button({ 
  variant = 'default', 
  size = 'md',
  children, 
  className = '',
  ...props 
}: ButtonProps) {
  const baseStyles = 'rounded-md transition-colors duration-200';
  const sizeStyles = {
    sm: 'px-3 py-1 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  } as const;
  const variantStyles = {
    default: 'bg-blue-500 text-white hover:bg-blue-600',
    outline:
      'border-2 border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700',
    destructive: 'bg-red-500 text-white hover:bg-red-600',
  };

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
} 
