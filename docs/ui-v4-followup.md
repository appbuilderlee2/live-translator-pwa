# UI and lecture/traveler follow-up

## Changes

- History is an independently scrolling sidebar rather than a non-shrinking stack above the transcript. Closing History preserves the selected session and reading position; Back to live remains explicit.
- The desktop mic is 72 × 72 CSS pixels. Compact-height layouts keep the composer, keyboard hint, mic and bilingual labels in a right-hand panel. A ResizeObserver reserves the fixed composer's actual height so Large UI cannot cover transcript actions.
- Copy/Download wait up to two seconds for translations, then mark every still-incomplete row, including rows with partial Chinese. Exports include confidence, provisional/final-unavailable notes and the same warnings as the cards.
- Filler/function-word-only interim fragments do not become captions or preview translation requests. Meaningful short fragments and function words within complete phrases are retained.
- The first speech-service network error restarts recognition immediately on `end`. Repeated failures back off until recognition results resume. Native speech-service/audio startup latency is not controlled by the app.
- Google retries switch between `translate.googleapis.com` and `translate.google.com`. Upstream starts are spaced by at least 150ms per server process; committed requests retain priority over previews. The existing per-attempt timeouts and three-second automatic-retry-delay cap remain.
- Service-worker upgrades use skipWaiting/clientsClaim and outdated precache cleanup. Navigations are network-first with a three-second fetch deadline and a precached-shell fallback, including when the runtime navigation cache is empty.

## Traveler v4 run 3 evidence

Source: `/home/ubuntu/attachments/da1c1b47-76bd-46fc-a7b9-76d92e7cbe71/live-translator-v4-speech.jsonl`.

Between playback begin `2026-11-21T16:45:05.184Z` and the phone final at `16:45:14.741Z`, there are 15 result events. Neither `6:30` nor `$25` appears in **any alternative**, interim or final, in that window. Earlier-run cards remain in the log but are not new recognition events.

```text
16:45:09.170Z interim: "the" (confidence 0.009999999776482582)
16:45:12.974Z interim: "can"
16:45:13.057Z interim: "can I"
16:45:14.741Z final: "can I pay with my mobile phone"
```

The missing train/price wording was not delivered to the app in this run. The separate app bug was publishing/translating the lone interim `the`; the new regression covers that pause/replacement and the recognizer's repartitioning of the phone phrase.

## Checks

- Unit tests: 76 passed, 0 failed.
- The deterministic storm integration uses the real client retry, server endpoint fallback/rate limiting and automatic recovery scheduler. At one caption per second, 100 of 200 API responses are HTTP 502; all 100 captions recover automatically, with maximum recovery 4650ms in virtual time. This is a measured bound for that failure/arrival pattern, **not** a universal recovery guarantee: a provider can keep failing a particular caption indefinitely even while succeeding half its aggregate requests.
- Browser: three saved conversations, Large UI, selected transcript remains 171px high at 1280×800; closing History preserves scrollTop 200 and selected saved session. Empty History is also covered.
- Actual Chrome zoom via native Ctrl+plus: 1280×800 at 200% produces a 640×400 CSS viewport and devicePixelRatio 2. Composer, hint, 72px mic, mic label and TTS labels fit without scrolling the controls.
- At 1920×993 with Large UI, Save/Copy/Download are above the composer and center hit-tests reach each button.
- Browser export: an immediate download waits for the Chinese response; Copy during continued 502s stops waiting and includes the pending marker, English, confidence and boundary warning.
- Synthetic old-service-worker upgrade: new worker claims the open tab, removes the old precache, normally reloads fresh network HTML, falls back in approximately three seconds when navigation hangs with an empty runtime cache, and reloads offline while retaining local storage.

The tester's actual old profile and the original causes of its reload stall / upstream 502s were not reproduced. The report itself did not isolate those causes. No new native-microphone or physical-device replay was performed.

## Browser artifacts

Screenshots in `/home/ubuntu/screens/`:

- `v3-saved-large-three.png`, `v3-saved-history-closed.png`
- `v3-saved-large-three-1920.png`
- `v3-desktop-200-percent.png`
- `v3-desktop-mic-72.png`
- `v3-desktop-large-1920-actions.png`

Reusable browser checks (Playwright from the existing QA environment, Chrome CDP port 29229): `/home/ubuntu/browser-checks/v3-ui-layout.mjs`, `v4-export-ui.mjs`, `v4-sw-upgrade.mjs`. The SW check uses a temporary proxy on 3006 and a production server on 3004; UI/export checks use the development copy on 3005. Test/build logs: `/home/ubuntu/screens/v4-ui-{tests,build}.log`.
