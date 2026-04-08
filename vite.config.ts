// ==========================================
// 前端构建配置
// ==========================================
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'movie-rating-hub',
        short_name: 'movie-rating-hub',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        lang: 'en',
        background_color: '#ffffff',
        theme_color: '#ffffff',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/image\.tmdb\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }
            }
          },
          {
            urlPattern: /^https:\/\/tmdb\.ratefuse\.cn\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-ratefuse-mirror',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }
            }
          },
          {
            urlPattern: /^\/tmdb\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-site-proxy',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }
            }
          },
          {
            urlPattern: /^\/tmdb-images\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-images-site-proxy',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }
            }
          },
          {
            urlPattern: /\/logos\/.*\.(png|svg|ico)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-logos',
              expiration: { maxEntries: 50, maxAgeSeconds: 365 * 24 * 60 * 60 }
            }
          },
        ],
      },
    }),
    visualizer({
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  optimizeDeps: {
    include: ['lucide-react', 'react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'axios'],
  },
  server: {
    proxy: {
      '/auth': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const cookies = proxyRes.headers['set-cookie'];
            if (cookies) {
              proxyRes.headers['set-cookie'] = cookies.map((cookie: string) =>
                cookie
                  .replace(/;\s*Secure/gi, '')
                  .replace(/;\s*Domain=[^;]+/gi, '')
              );
            }
          });
        },
      },
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const cookies = proxyRes.headers['set-cookie'];
            if (cookies) {
              proxyRes.headers['set-cookie'] = cookies.map((cookie: string) =>
                cookie
                  .replace(/;\s*Secure/gi, '')
                  .replace(/;\s*Domain=[^;]+/gi, '')
              );
            }
          });
        },
      },
      '/tmdb': {
        target: 'https://tmdb.ratefuse.cn',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/tmdb/, '/t/p'),
      },
      '/tmdb-images': {
        target: 'https://tmdb.ratefuse.cn',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/tmdb-images/, '/t/p'),
      },
    },
  },
  build: {
    target: 'es2015',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router') || (id.includes('/react/') && !id.includes('react-'))) {
              return 'react-vendor';
            }
            if (id.includes('@tanstack/react-query')) {
              return 'query';
            }
            if (id.includes('@headlessui') || id.includes('lucide-react')) {
              return 'ui-vendor';
            }
            if (id.includes('html-to-image') || id.includes('html2canvas') || id.includes('modern-screenshot')) {
              return 'export-vendor';
            }
          }
        }
      }
    },
    sourcemap: false,
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
  },
  esbuild: {
    target: 'es2015',
    legalComments: 'none',
  }
});
