# Long-lecture v5 follow-up

## Request volume and recovery

The supplied lecture report records 1,809 browser requests (638 previews, 1,171 committed), caption 64 requested 93 times, and direct probes returning 429 from both Google hosts. Historical 502s cannot all be attributed to 429: their upstream status was discarded by the former handler. The old per-caption active map already guarded concurrent work in one page; the reachable load amplifiers were frequent serial recovery, separate browser/server request retries, and the 500ms preview effect. Reconnect/reload could also bypass a pending retry deadline; this is a code-path finding, not proof that reconnect caused the recorded lecture's request count.

`src/translation-queue.mjs` is now the only committed-caption retry owner. Commit, revision, history restoration, manual Retry and reconnect enqueue IDs into one serial oldest-first queue. A provider deadline in localStorage survives reloads and is observed on storage events. Interim translation is disabled (including the server preview API). Invalid translation content is deferred per caption so a poisoned caption cannot permanently block later work. Only the active caption spins; waiting rows remain pending/error with a clear delayed/throttled backlog notice.

`shared/provider.mjs` shares 5.5s upstream-start spacing and exponential cooldown across clients of the handler/process. HTTP failures and network/body failures retain typed reasons and sanitized structured logs. There is no nested provider retry: after cooldown the next Google probe alternates endpoints. Backoff is 5/10/20/40/60s, capped there; rate spacing rounds the first response to 6s. Longer valid Retry-After extends the wait (24-hour safety cap). This is process/isolate state, not a distributed quota across replicas.

Deterministic fixture output (`npm test`):

```text
Server cooldown: 6, 10, 20, 40, 60, 60s (first includes 5.5s rate spacing); blocked clients add zero upstream calls; healthy starts >=5500ms apart
22-min 429 lecture: 93 captions; API requests 118; per-caption min 1, max 26; caption64 1; previews 0; max in flight 1; upstream 118; throttled probes 25; all 93 recovered oldest-first by 1842500ms (backlog drain 522500ms after provider recovery)
502 fixture: 100 captions at 1/s; 100/200 API responses HTTP 502; exactly two requests per caption; all recovered oldest-first; max recovery 946000ms with conservative 5.5s pacing
```

These are fixture bounds, not a guarantee of successful Google translation. In particular, the earlier fast-502 recovery timing no longer applies under conservative global pacing; a large backlog legitimately takes minutes. The 22-minute fixture includes repeated enqueue/reconnect attempts and a queue reload, and asserts caption 64's count, bounded counts for all captions, no previews, one in-flight request and eventual ordered recovery.

OpenAI was already selected by nonempty `OPENAI_API_KEY`; it remains primary and streaming, with `OPENAI_MODEL` defaulting to gpt-4o-mini. Both-provider safety tests and the primary-selection fixture pass. No key was added, and no live OpenAI check was performed. README/RUN document configuration and limits.

## Local meaning regression

The previous local path already called `negationMismatch`, but that check accepted an unrelated negative clause when the negative-word count was unchanged. It did not check the scope of “not in a hurry.” Replaying the exact unpunctuated paragraph through the old 120-character splitter shows an unsafe boundary: chunk one ends `walking route on the map we are not`; chunk two begins `in a hurry we would rather...`. The new boundaries retain `we are not in a hurry` as one chunk. This input defect is verified; whether it fully explains the native model's exact output has not been verified by replaying the real model. The local function builds its chunks/output per call, so there is no shared JS caption buffer; concurrent calls did share the native Translator instance. Cross-caption native-model contamination is unproven.

Local captions now use a shared serial limiter, abort signals and explicit boundaries around “we are not” / “we would rather.” The scoped check requires a no-hurry meaning; a conservative travel dictionary checks missing content and obvious introduced safe-route concepts. The exact `we are not in a hurry` → `我們不是最安全的步行路線` regression and whole-caption fallback are tested, as are serialized inputs and valid/empty/error cases. These heuristics cannot prove arbitrary semantic equivalence. The actual Chrome model was not replayed in this batch.

Browser fixture: first API response 429, next 200; five reconnect events and Retry do not add requests. Exactly **2 requests**, **1 max in flight**, **0 previews**; delay and interruption notices disappear after recovery in **6351ms**. Screenshots: `/home/ubuntu/screens/v5-provider-throttled.png`, `/home/ubuntu/screens/v5-provider-recovered.png`.

## Layout

At widths up to 720px and heights up to 500px, use normal document flow rather than a fixed composer. Transcript height is **180px**, with the toolbar/actions before the composer; controls and labels are reached by ordinary page scrolling. This deliberately does not try to display all caption/control/settings content simultaneously at 200%.

Chrome at **640×400 CSS, DPR 2**, Large UI, 42px captions and listening active: scrolled/unscrolled caption height **180px**, overlap **0**, document action bottom **335px**, composer top **348px** (13px clearance), no horizontal overflow. Checked at scrollY 0, 80 and 672. Screenshots: `/home/ubuntu/screens/v5-lecture-zoom-unscrolled.png`, `/home/ubuntu/screens/v5-lecture-zoom-scrolled.png`.

Existing strict UI script also passes: 375×812 Large on/off **203.82 / 297.31px** captions, 1920×993 Large **344.01px**, 852×393 landscape **171px**, all zero action/composer overlap and 13px vertical or 17px horizontal clearance. Browser page errors: `[]`.

## Actual historical worker investigation

Built historical commit **a6c7843** into `/home/ubuntu/pkg/historical-v2`, with its actual generated worker and assets. Its generated `registerSW.js` registers **/sw.js, scope /**. The generated worker already has skipWaiting/clientsClaim/cleanup, and a precached index navigation route. No alternate worker filename was found in this historical configuration, so no speculative legacy-URL kill switch was added.

`/home/ubuntu/browser-checks/v5-real-v2-upgrade.mjs` installs and controls a fresh Chrome profile with that actual worker, reloads the historical shell, then switches the same origin to the current production distribution. First ordinary reload **171ms**, initially old cached shell. After observing controller change, obsolete-asset removal and actual new-worker activation, ordinary reload **1212ms**, current shell and history preserved. Current `/`, `/index.html`, `/sw.js`, `/registerSW.js` answer **200 in 5/2/1/1ms**. HTML is now no-store; worker and registration script no-cache. Screenshot: `/home/ubuntu/screens/v5-real-v2-upgrade.png`.

The tester's **53s stall was not reproduced** with the real historical build and healthy local network. Cache-first does explain why the first reload can still show the old shell, but it does not establish the 53s cause; the quick cached reload is counterevidence to cache-first alone causing it. Existing cache entries cannot retroactively be changed by new HTTP headers. A trace of the affected profile's navigation, SW update/install requests and controller lifecycle is needed to distinguish an old worker/network hang from failed/delayed new-worker installation. No claim that the original stall is fixed.

## Recognition feasibility

`src/speech.mjs` restarts synchronously in onend on a normal end or first network failure. There is no await before start; delayed late-final reconciliation runs separately. Repeats back off until results resume, as covered by the existing speech lifecycle test. onspeechend means an utterance stopped, not that the continuous recognition session ended; forcibly ending there would introduce more boundaries. onerror can precede onend, while recognition is still started.

Real Chrome overlap probe:

```text
Native Web Speech overlap feasibility: InvalidStateError: Failed to execute 'start' on 'SpeechRecognition': recognition has already started.
```

The supplied native measurements remain **19–41ms end→start** but **0.247–2.416s audio lifecycle gaps** (4.815s total); these are not a measurement of lost spoken-word duration. No new audio-gap/accuracy replay was performed. Web Speech exposes no audio buffer or supported overlapping capture. Keep immediate onend restart rather than adding premature stop/restart logic, and document the limitation; use an independent recording/provider with buffered audio if losslessness is required.

## Checks

`npm test`: **91 passed, 0 failed**. `VITE_DISABLE_SW=1 npm run build`: built in **1.31s**. Normal `npm run build` last: built in **1.29s**, PWA **116 entries (3770.34 KiB)**. Existing >500kB bundle warning remains. `git diff --check`: no output.

Scripts/logs: `/home/ubuntu/browser-checks/v5-lecture-{tests,build-nosw,build,ui,zoom,regression}.log`, `v5-real-v2-upgrade.log`.
