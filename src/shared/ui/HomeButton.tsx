// ==========================================
// 首页入口按钮组件
// ==========================================
import { useLocation, useNavigate } from 'react-router-dom';

export const HomeButton = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleHomeClick = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ratefuse:closeSearchOverlay'));
    }

    const forceState = { clearSearch: true, _ts: Date.now() };
    navigate('/', {
      replace: location.pathname === '/',
      state: forceState,
    });
  };

  return (
    <button
      type="button"
      onClick={handleHomeClick}
      className="w-7 h-7 flex items-center justify-center rounded-full glass-button transition-all duration-200 hover:scale-110"
      aria-label="主页"
    >
      <img src="/logos/home.png" alt="主页" className="w-[18px] h-[18px] object-contain" />
    </button>
  );
};
