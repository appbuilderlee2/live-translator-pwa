# V5 follow-up

- Portrait phones use History as a temporary overlay. Selecting a saved session closes it without losing the saved selection or reading position. Decorative heading/count/Aa text is omitted on narrow portrait screens; the subtitle size control remains available.
- Jump is a normal-flow footer control, never an overlay on captions. It appears only when more content is below the viewport. Saved transcripts and live transcripts with no unread captions use “Jump to bottom”; only positive live unread counts say “new captions”.
- Replay uses a hover/focus tooltip with the app's CJK font stack and accessible description, not an unstyleable native title.
- OpenCC `cn` → `twp` demonstrably converts `社區健走活動` to `社群健走活動`. The final phrase replacement now includes 健走, restoring 社區 after OpenCC. Repeated 請 is collapsed with a deliberately narrow accidental-double allowlist; legitimate reduplications are untouched.
- The earlier report's Taipei input is `Please take a taxi to the Taipei subway station.` The former length threshold accepted `請搭乘計程車到中華`: nine output letters exceed nine source words × 0.65, and there are no figures to catch. Required Taipei/station coverage now rejects this and falls back with the complete original input. Local output is normalized before clause coverage checks, and retains existing figure, placeholder, negation and medical checks.
- Bare `$` is now neutral in typed input as well as speech. Explicit US/USD and other named currencies remain explicit. A local model that loses the neutral-currency placeholder falls back instead of silently emitting 美元.
- `Retry-After` supports seconds and HTTP dates, capped at three seconds, while ordinary failures retain backoff and cancellation. Exhausted upstream 429s remain HTTP 429 with a capped header for browser retries. Optional `GOOGLE_TRANSLATE_URL` and `GOOGLE_TRANSLATE_FALLBACK_URL` override the primary/alternate Google-compatible URLs. Default endpoints remain googleapis.com and google.com. These are not independent providers or a reliability guarantee.

## Evidence and remaining defect

`/home/ubuntu/browser-checks/v5-ui.mjs` connects to the existing desktop Chrome, resets browser zoom to 100%, asserts a real 375×812 CSS viewport, seeds three saved sessions, and uses 42px subtitles. It checks saved/live/zero/positive-unread jumps, History selection/position preservation, and tooltip hover/focus.

Measured paused saved transcript height with the Jump control present:

| Large interface | Caption height | Caption bottom | Jump top | Actions bottom | Composer top |
| --- | ---: | ---: | ---: | ---: | ---: |
| On | 200px | 366px | 371px | 520.59px | 515.41px |
| Off | 275.31px | 441.31px | 446.31px | 558.50px | 571.50px |

**Remaining:** Large-interface footer extends about 5.18px behind the composer when paused. The 200px caption area and Jump remain unobscured, but the Download footer label is partly clipped. Three layout attempts did not fully eliminate this; do not describe the whole layout as passing. No further layout attempts were made.

Screenshots, visually inspected:

- `/home/ubuntu/screens/v5-mobile-large-on.png`
- `/home/ubuntu/screens/v5-mobile-large-off.png`
- `/home/ubuntu/screens/v5-replay-tooltip.png` (Chinese glyphs visible)

The browser reported no page errors. Local-model/provider tests use fixtures, not the actual Chrome translation model or live OpenAI. No new native-microphone replay was performed. Provider availability during package verification must be reported separately.

Final checks: `npm test` reported 84 tests, 84 pass, 0 fail. Both normal builds and `VITE_DISABLE_SW=1 npm run build` completed; normal production build was last. The existing >500kB chunk warning remains. Logs: `/home/ubuntu/browser-checks/v5-{test,build,build-nosw,build-final,ui}.log`.

The rebuilt `/home/ubuntu/pkg/live-translator.zip` contains 233 files (dist, shared, server.mjs and RUN.md; no node_modules). Extracted plain-Node server verification on port 3004 returned `你好嗎？`, `POST /api/translate HTTP 200`, and `GET /sw.js HTTP 200`; service-worker bytes matched both the extracted and repository production build. This one live translation succeeded; it does not establish Google reliability or live 429 recovery.
