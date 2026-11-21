# Live Translator — production package

Requires Node 22+. No npm install is needed for the extracted production package.

```sh
PORT=3002 node server.mjs
```

Keep `dist/`, `shared/` (including `shared/vendor/`) and `server.mjs` together; run from that directory. Open http://localhost:3002. A microphone requires localhost or HTTPS.

## Translation providers

Set `OPENAI_API_KEY` in the **server environment** to select OpenAI as the primary provider. Optional `OPENAI_MODEL` defaults to `gpt-4o-mini`. Do not put secrets in browser code or variables prefixed `VITE_`. No key is included or required to start the app.

Without a key, the server uses Google's free endpoints. Optional `GOOGLE_TRANSLATE_URL` and `GOOGLE_TRANSLATE_FALLBACK_URL` select compatible endpoints. They may both reject requests (429 automated queries); switching hosts does not guarantee recovery.

Committed captions are processed oldest-first, with no server interim previews. The server shares cooldown and 5.5-second upstream pacing across all its clients. Upstream 429/5xx back off exponentially to 60 seconds; `Retry-After` can extend this (24-hour safety cap). Requests during cooldown return typed JSON 429 and `Retry-After`, without contacting a provider. Failures retain the English and show a delayed/throttled notice. Backlogs drain only after recovery and may take several minutes. Client cooldown deadlines persist across reload/reconnect; repeated Retry clicks do not add requests or bypass cooldown.

`/api/translate` requires POST JSON `{ "text": "Hello", "context": [] }`. Errors use 429/503/502 and reason codes (`upstream_rate_limited`, `provider_cooldown`, `upstream_error`, etc.); no generic-502 conversion of throttling. `/sw.js` and `/registerSW.js` use `no-cache`; HTML uses `no-store`. Offline shell and history work after installation; translation needs a usable local model or provider. An already-controlling legacy worker may still answer the first navigation before its update activates.

Failures are logged as sanitized JSON (provider, endpoint path, upstream status, latency, short body snippet). Do not expose the unauthenticated API to untrusted traffic without platform authentication/rate limits. Cooldowns are per server process/isolate, not a distributed deployment-wide quota.

The Node server bounds each API request to 30 seconds, including receiving its body and streaming its response. A timeout before response headers returns retryable HTTP 503 `translation_timeout`; after headers, the incomplete stream is disconnected rather than falsely completed. Disconnects cancel the response source. Static GET/HEAD responses include their exact byte `Content-Length`; streaming translations remain chunked. These safeguards do not establish the cause of profile-specific legacy-worker reload stalls.

Native Web Speech cannot buffer audio across restarts. The app restarts immediately from `onend` on normal ends and the first network failure, but cannot eliminate browser/service audio gaps. Verify important figures and keep an independent recording when completeness is essential.

On browsers supporting Service Worker Static Routing, navigations race the network without waiting for worker startup; the worker retains offline fallback. After an unusually slow controlled load, the page performs bounded worker-update/re-registration attempts without clearing transcripts or reloading. Recovery of an already-stuck browser needs the updated page to load once and the new worker to install successfully. See `docs/service-worker-startup.md` in the source repository.
