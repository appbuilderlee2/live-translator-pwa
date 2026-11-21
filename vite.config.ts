import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig(({ mode }) => {
  const disabled = loadEnv(mode, '.', '').VITE_DISABLE_SW === '1'
  return { plugins: [react(), VitePWA({ registerType: 'autoUpdate', injectRegister: false, selfDestroying: disabled, useCredentials: true, manifest: { name: 'Live Translator', short_name: '譯', description: 'English to Traditional Chinese, in the moment.', theme_color: '#101715', background_color: '#101715', display: 'standalone', start_url: '/', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }, workbox: {
    importScripts: ['sw-navigation.js'],
    skipWaiting: true, clientsClaim: true, cleanupOutdatedCaches: true,
    globPatterns: ['**/*.{js,css,png,svg,ico,woff2}'],
    additionalManifestEntries: [{ url: 'index.html?offline=1', revision: Date.now().toString() }],
    navigateFallback: null,
    runtimeCaching: [{
      urlPattern: ({ request }) => request.mode === 'navigate', handler: 'NetworkFirst',
      options: {
        cacheName: 'translator-navigation-v1', networkTimeoutSeconds: 3,
        cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 5 },
        precacheFallback: { fallbackURL: 'index.html?offline=1' },
        plugins: [{ requestWillFetch: async ({ request }: { request: Request }) => new Request(request, { signal: AbortSignal.timeout(3000) }) }]
      }
    }]
  } })], server: { proxy: { '/api': 'http://localhost:3000' } } }
})
