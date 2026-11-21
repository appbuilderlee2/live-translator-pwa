# V5 follow-up

- Portrait phones use History as a temporary overlay. Selecting a saved session closes it without losing the saved selection or reading position. Decorative heading/count/Aa text is omitted on narrow portrait screens; the subtitle size control remains available.
- Jump is a normal-flow footer control, never an overlay on captions. It appears only when more content is below the viewport. Saved transcripts and live transcripts with no unread captions use “Jump to bottom”; only positive live unread counts say “new captions”.
- Replay uses a hover/focus tooltip with the app's CJK font stack and accessible description, not an unstyleable native title.
- OpenCC `cn` → `twp` demonstrably converts `社區健走活動` to `社群健走活動`. The final phrase replacement now includes 健走, restoring 社區 after OpenCC. Repeated 請 is collapsed with a deliberately narrow accidental-double allowlist; legitimate reduplications are untouched.
- The earlier report's Taipei input is `Please take a taxi to the Taipei subway station.` The former length threshold accepted `請搭乘計程車到中華`: nine output letters exceed nine source words × 0.65, and there are no figures to catch. Required Taipei/station coverage now rejects this and falls back with the complete original input. Local output is normalized before clause coverage checks, and retains existing figure, placeholder, negation and medical checks.
- Bare `$` is now neutral in typed input as well as speech. Explicit US/USD and other named currencies remain explicit. A local model that loses the neutral-currency placeholder falls back instead of silently emitting 美元.
- `Retry-After` supports seconds and HTTP dates, capped at three seconds, while ordinary failures retain backoff and cancellation. Exhausted upstream 429s remain HTTP 429 with a capped header for browser retries. Optional `GOOGLE_TRANSLATE_URL` and `GOOGLE_TRANSLATE_FALLBACK_URL` override the primary/alternate Google-compatible URLs. Default endpoints remain googleapis.com and google.com. These are not independent providers or a reliability guarantee.

## Evidence and footer follow-up

`/home/ubuntu/browser-checks/v5-ui.mjs` connects to the existing desktop Chrome, resets browser zoom to 100%, asserts a real 375×812 CSS viewport, seeds three saved sessions, and uses 42px subtitles. It checks saved/live/zero/positive-unread jumps, History selection/position preservation, and tooltip hover/focus. The strict footer/composer no-overlap assertion is restored. Additional 1920×993 Large and 852×393 Large landscape checks assert zero rectangle overlap and hit-test every footer action.

Measured paused saved transcript height with the Jump control present:

| Large interface | Caption height | Caption bottom | Jump top | Actions bottom | Composer top |
| --- | ---: | ---: | ---: | ---: | ---: |
| On | 203.82px | 369.82px | 372.82px | 502.41px | 515.41px |
| Off | 297.31px | 463.31px | 466.31px | 558.50px | 571.50px |

The previous 5.18px Large-interface footer overlap is fixed by reducing only action-button padding and footer gaps/padding at widths ≤420px. Copy, Download and Save stay in one grid row, labels remain unchanged, and the 44px minimum targets remain. Both portrait modes have 0px overlap and a 13px gap above the composer with Jump present. At 1920×993 Large, captions measure 344.01px with a 13px vertical gap; at 852×393 Large landscape, captions remain 171px with a 17px horizontal gap from the side composer. All footer center hit-tests succeed in desktop and landscape.

Screenshots, visually inspected:

- `/home/ubuntu/screens/v5-mobile-large-on.png`
- `/home/ubuntu/screens/v5-mobile-large-off.png`
- `/home/ubuntu/screens/v5-replay-tooltip.png` (Chinese glyphs visible)
- `/home/ubuntu/screens/v5-desktop-large.png`
- `/home/ubuntu/screens/v5-landscape.png`

The browser reported no page errors. Local-model/provider tests use fixtures, not the actual Chrome translation model or live OpenAI. No new native-microphone replay was performed. Provider availability during package verification must be reported separately.

Final checks: `npm test` reported 84 tests, 84 pass, 0 fail. Both normal builds and `VITE_DISABLE_SW=1 npm run build` completed; normal production build was last. The existing >500kB chunk warning remains. Logs: `/home/ubuntu/browser-checks/v5-{test,build,build-nosw,build-final,ui}.log`.

The rebuilt `/home/ubuntu/pkg/live-translator.zip` contains 233 files (dist, shared, server.mjs and RUN.md; no node_modules). Extracted plain-Node server verification on port 3004 returned `你好嗎？`, `POST /api/translate HTTP 200`, and `GET /sw.js HTTP 200`; service-worker bytes matched both the extracted and repository production build. This one live translation succeeded; it does not establish Google reliability or live 429 recovery.
