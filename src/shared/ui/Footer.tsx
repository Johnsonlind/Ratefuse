// ==========================================
// 页面页脚组件
// ==========================================
export function Footer({ variant = 'default' }: { variant?: 'default' | 'onDark' }) {
  const onDark = variant === 'onDark';

  return (
    <footer
      aria-label="品牌署名"
      className="
        mt-auto flex justify-center px-4 py-6
        pb-[max(1.5rem,env(safe-area-inset-bottom))]
        relative
      "
    >
      <div
        className="
          pointer-events-none
          absolute inset-x-0 bottom-0
          h-full
          backdrop-blur-[6px]
          bg-gradient-to-t
          from-gray-100/50 via-gray-50/20 to-transparent
          dark:from-black/40 dark:via-black/20 dark:to-transparent
        "
      />

      <div className="relative z-10 flex gap-4">
        <a
          href="https://weibo.com/u/2238200645"
          target="_blank"
          rel="noopener noreferrer"
          className={`
            inline-flex items-center
            transition-all duration-200
            active:scale-95
            ${onDark
              ? 'drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]'
              : ''
            }
          `}
        >
          <img src="/logos/weibo.png" alt="Weibo" className="h-6 w-6" />
        </a>

        <a
          href="https://www.xiaohongshu.com/user/profile/5f45e9ef0000000001003969"
          target="_blank"
          rel="noopener noreferrer"
          className={`
            inline-flex items-center
            transition-all duration-200
            active:scale-95
            ${onDark
              ? 'drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]'
              : ''
            }
          `}
        >
          <img src="/logos/rednote.png" alt="Rednote" className="h-6 w-6" />
        </a>
      </div>
    </footer>
  );
}
