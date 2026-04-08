// ==========================================
// 平滑滚动 Hook
// ==========================================
import { useEffect, useRef } from 'react';
import Lenis from 'lenis';

export function useLenis() {
  const lenisRef = useRef<Lenis | null>(null);
  useEffect(() => {
    const schedule = typeof requestIdleCallback !== 'undefined'
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 200 })
      : (cb: () => void) => setTimeout(cb, 0);
    const id = schedule(() => {
      lenisRef.current = new Lenis({
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        lerp: 0.08,
        orientation: 'vertical',
        gestureOrientation: 'vertical',
        smoothWheel: true,
        wheelMultiplier: 1.2,
        touchMultiplier: 1.5,
        infinite: false,
        syncTouch: false,
        autoRaf: true,
      });
      (window as any).lenis = lenisRef.current;
    });
    return () => {
      if (typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(id as number);
      else clearTimeout(id as number);
      lenisRef.current?.destroy();
      lenisRef.current = null;
    };
  }, []);
}
