import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig(({ mode }) => {
  const disabled = loadEnv(mode, '.', '').VITE_DISABLE_SW === '1'
  return { plugins: [react(), VitePWA({ registerType: 'autoUpdate', injectRegister: disabled ? false : 'auto', selfDestroying: disabled, useCredentials: true, manifest: { name: 'Live Translator', short_name: '譯', description: 'English to Traditional Chinese, in the moment.', theme_color: '#101715', background_color: '#101715', display: 'standalone', start_url: '/', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }, workbox: { globPatterns: ['**/*.{js,css,html,png,svg,ico}'] } })], server: { proxy: { '/api': 'http://localhost:3000' } } }
})
