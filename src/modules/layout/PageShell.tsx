// ==========================================
// 通用页面外壳组件
// ==========================================
import type { ReactNode } from 'react';
import { NavBar } from '../../shared/ui/NavBar';
import { ThemeToggle } from '../../shared/ui/ThemeToggle';
import { ScrollToTopButton } from '../../shared/ui/ScrollToTopButton';
import { Footer } from '../../shared/ui/Footer';

type MaxWidth = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full';

const maxWidthClass: Record<MaxWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
  full: 'max-w-full',
};

export function PageShell({
  children,
  maxWidth = '7xl',
  contentClassName = '',
  navPanelClassName = '',
  withFooter = true,
  withNav = true,
  withThemeToggle = true,
  withScrollToTop = true,
  withTopOffset = true,
}: {
  children: ReactNode;
  maxWidth?: MaxWidth;
  contentClassName?: string;
  navPanelClassName?: string;
  withFooter?: boolean;
  withNav?: boolean;
  withThemeToggle?: boolean;
  withScrollToTop?: boolean;
  withTopOffset?: boolean;
}) {
  return (
    <>
      {withNav && <NavBar panelClassName={navPanelClassName} />}
      <div
        className={`flex min-h-screen flex-col ${withTopOffset ? 'pt-16' : ''} safe-area-bottom`}
      >
        {withThemeToggle && <ThemeToggle />}
        {withScrollToTop && <ScrollToTopButton />}

        <main
          className={`mx-auto w-full flex-1 ${maxWidthClass[maxWidth]} px-4 ${contentClassName}`}
        >
          {children}
        </main>

        {withFooter && <Footer />}
      </div>
    </>
  );
}
