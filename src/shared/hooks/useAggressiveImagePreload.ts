// ==========================================
// 图片预加载 Hook
// ==========================================
import { useEffect, useRef } from 'react';

export function useAggressiveImagePreload(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean = true
) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const decodedSet = useRef<Set<string>>(new Set());
  const pendingDecode = useRef<Map<string, HTMLImageElement>>(new Map());
  const activeLoads = useRef<Set<string>>(new Set());
  const loadQueue = useRef<string[]>([]);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const container = containerRef.current;
    if (!container) return;

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth < 768;
    
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || 
                     (/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream);
    const isSafariMobile = isMobile && isSafari;

    const MAX_CONCURRENT_LOADS = isSafariMobile ? 2 : (isMobile ? 6 : 20);
    const PRELOAD_SCREENS = isSafariMobile ? 0.5 : (isMobile ? 2 : 6);
    const ENABLE_FORCE_DECODE = !isMobile;

    const processQueue = () => {
      while (
        loadQueue.current.length > 0 &&
        activeLoads.current.size < MAX_CONCURRENT_LOADS
      ) {
        const url = loadQueue.current.shift();
        if (url && !activeLoads.current.has(url) && !decodedSet.current.has(url)) {
          const imgElement = container.querySelector(`img[src="${url}"], img[data-src="${url}"]`) as HTMLImageElement;
          if (imgElement) {
            preloadAndDecode(imgElement, url);
          }
        }
      }
    };

    const cleanup = () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      pendingDecode.current.forEach((img) => {
        img.onload = null;
        img.onerror = null;
        img.src = '';
      });
      pendingDecode.current.clear();
      activeLoads.current.clear();
      loadQueue.current = [];
      canvasRefs.current.clear();
    };

    const markDecoded = (url: string) => {
      decodedSet.current.add(url);
      activeLoads.current.delete(url);
      processQueue();
    };

    const preloadAndDecode = (imgElement: HTMLImageElement, url: string) => {
      if (decodedSet.current.has(url) || activeLoads.current.has(url)) return;
      
      if (loadQueue.current.includes(url)) return;

      if (activeLoads.current.size >= MAX_CONCURRENT_LOADS) {
        if (!loadQueue.current.includes(url)) {
          loadQueue.current.push(url);
        }
        return;
      }

      activeLoads.current.add(url);
      
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.crossOrigin = imgElement.crossOrigin || 'anonymous';
      
      img.onload = () => {
        if (ENABLE_FORCE_DECODE) {
          const idleCallback = typeof (window as any).requestIdleCallback === 'function'
            ? (window as any).requestIdleCallback
            : (cb: () => void, opts?: { timeout?: number }) => setTimeout(cb, opts?.timeout || 0);
          
          idleCallback(() => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0);
                canvasRefs.current.set(url, canvas);
              }
            } catch (e) {
            }
            markDecoded(url);
          }, { timeout: 100 });
        } else {
          markDecoded(url);
        }
      };
      
      img.onerror = () => {
        markDecoded(url);
      };
      
      img.src = url;
      pendingDecode.current.set(url, img);
    };

    const viewportHeight = window.innerHeight;
    const rootMargin = `${viewportHeight * PRELOAD_SCREENS}px`;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const img = entry.target as HTMLImageElement;
          if (!img || img.tagName !== 'IMG') return;
          
          const url = img.src || img.getAttribute('data-src') || '';
          if (!url || url.startsWith('data:') || decodedSet.current.has(url)) return;

          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            if (img.complete && img.naturalWidth > 0) {
              markDecoded(url);
            } else {
              preloadAndDecode(img, url);
            }
          }
        });
      },
      {
        root: null,
        rootMargin,
        threshold: [0, 0.1, 0.5, 1],
      }
    );

    const images = container.querySelectorAll('img');
    images.forEach((img) => {
      const url = img.src || img.getAttribute('data-src') || '';
      if (url && !url.startsWith('data:')) {
        observerRef.current?.observe(img);
      }
    });

    const mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            const images = element.querySelectorAll('img');
            images.forEach((img) => {
              const url = img.src || img.getAttribute('data-src') || '';
              if (url && !url.startsWith('data:')) {
                observerRef.current?.observe(img);
              }
            });
            if (element.tagName === 'IMG') {
              const url = element.getAttribute('src') || element.getAttribute('data-src') || '';
              if (url && !url.startsWith('data:')) {
                observerRef.current?.observe(element);
              }
            }
          }
        });
      });
    });

    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      cleanup();
      mutationObserver.disconnect();
    };
  }, [enabled, containerRef]);
}
