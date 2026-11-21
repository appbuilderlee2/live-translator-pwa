# Live Translator 譯

A mobile-first, dark PWA for live English → Traditional Chinese (Taiwan) bilingual subtitles.

## Features
- Continuous speech recognition, live debounced translation previews and streamed final translations. Text input is always available (Enter to send, Shift+Enter for a new line).
- Chrome on-device Translator API first (`en` → `zh-Hant`), then a shared server API: OpenAI streaming if configured, otherwise the free Google Translate endpoint. The on-device model may need a first-time download and a user gesture; availability depends on Chrome and installed language models.
- Offline app shell; without an available on-device model, segments stay pending and automatically retry when connection returns. On-device translation works offline once its model is downloaded. Speech recognition itself may require internet, even with on-device translation.
- Traditional Chinese speech synthesis, automatic read-aloud toggle, tap to replay, subtitle size control and auto-scroll.
- Current conversation and saved sessions persist locally. History supports opening, copying, bilingual .txt export and deletion. Local browser storage is not a backup; export important conversations.

## Local development
Node.js 22+ recommended.
```sh
npm install
npm run icons # only needed to regenerate committed icons
npm run build
npm start # production Node server, port 3000
# In a second terminal for hot reload; API requests proxy to port 3000:
npm run dev
```
Production: `npm run build && PORT=3000 npm start`. The Node server serves `dist/`, SPA fallbacks and `/api/translate`. Bind is 0.0.0.0; use HTTPS through a reverse proxy for remote microphone access. No database needed.

`npm test` runs isolated API tests (no external services). `VITE_DISABLE_SW=1 npm run build` disables registration entirely. If you previously installed a service worker, unregister it in browser developer tools before testing the disabled build. Normal builds use generateSW precaching and auto-update.

## Vercel
1. Import this repository into Vercel as a Vite project.
2. Use build command `npm run build` and output directory `dist` (included in vercel.json).
3. Optionally set `OPENAI_API_KEY` in server environment variables and `OPENAI_MODEL` (default `gpt-4o-mini`). Without a key the free Google endpoint is used; it has no service guarantee and may be rate-limited. Never prefix server secrets with `VITE_`.
4. Deploy; `api/translate.ts` is an Edge Function using the same Web Request/Response handler as Node. Vercel supplies HTTPS. No Vercel token is needed for local use. No deployment has been made yet.

For Node, export those environment variables in the shell before `npm start`. Text is limited to 2,000 characters per segment. API clients receive 400 for malformed/empty/oversized input and 502 for upstream failures before streaming begins; errors after streaming starts surface as interrupted streams. This public API has no authentication: add platform-level rate limits before exposing to untrusted traffic, especially when using a paid key.

## Browser support & privacy
Speech recognition works in supported Chrome, Edge and Safari versions; support varies by OS. iOS Safari requires HTTPS and microphone permission (localhost is a secure-context exception on desktop). Firefox and unsupported browsers can use typed translation. Recognition automatically restarts while listening; permission and no-speech errors are shown. On-device Translator API support is primarily recent Chrome and is not universal. TTS requires an installed Chinese voice; zh-TW is preferred with any zh voice as fallback.

Translations use network services unless an on-device model is available. Speech recognition may send audio to the browser vendor. Transcripts remain in this browser's localStorage; text is sent to Google or OpenAI for network translation. Service workers cache the app shell, not API responses or transcripts.
