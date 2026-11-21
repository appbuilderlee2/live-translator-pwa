# Long-lecture follow-up on 0418f30

Production servers are not changed. The supplied 22:21 report ran 31291ad, not
0418f30. Provider/native-recognition behavior is not re-measured with live audio.

## Short zoomed viewport

At verified 960×496 CSS, DPR 2, Large UI, the banner-free baseline reproduced a
44px transcript with a fixed composer starting at y=251.20 while the action row
ended at y=415.20. The report's banner-present 0px state was not independently
reproduced before editing. The workspace height floor applied to the entire
card, not its caption area; the existing normal-flow exception ended at 720px
width, missing 960px entirely.

All viewports at most 600px high now use normal document flow with a 180px
transcript. Header/hero are hidden, and notifications and composer cannot overlay
the export footer. The JS sizing exception matches the CSS condition.
`/home/ubuntu/browser-checks/v5-ui.mjs` retains its previous cases and adds
960×496, 960×430 and 640×400 at DPR 2, Large on/off, listening/idle, outer scroll
0/130, all with a real provider-delay banner from a routed HTTP-429 fixture.
All 24 combinations have 180px captions and hit-testable Jump/Copy/Download/Save.
This is device-metrics emulation, not a new physical 200% Chrome-zoom recording.

## Every extra request

`lecture-request-classification.csv` records all 37 extras, previous/current
request IDs/statuses/times and SHA256s of the exact source strings. Each of the
130 network requests falls into exactly one caption's first-request through
final-success interval in the supplied CSV; per-caption counts match all 93 rows.
The translation-times CSV independently agrees on caption/source/final-seen time.

- 8 retries after 429; 13 retries after 503.
- 16 earlier-source revisions after a previous HTTP 200, across 15 captions.
- 0 other requests. No new production deduplication change is needed.

Failure-retry classification takes precedence: three of those retry requests
also changed English (caption 01 twice and 54 once). Caption 66's revision request
itself fails with 503; its next two requests are retries, not further revisions.
Caption 85 accounts for two earlier-source revisions. Caption 52's abort
diagnostic follows HTTP-200 headers and does not count as another dispatch.

For the 16 revision extras, the previous request differs from final English and
precedes the CSV's final-English observation. Native event flags/raw speech
events are not attached, so calling every such source version a native interim
is not justified. They are consistent with the already-fixed pre-final
pause-commit path. Caption 50 additionally has a native-final timestamp in the
report: first request 19:01:13.481, final 19:01:17.928, second request
19:01:19.452. Its exact partial/full sources are now replayed through the current
controller/queue for both interim and premature-final fragments: zero pre-final
dispatches, one settled full-source dispatch, no reload/retry extra. The initial
interim-event time is reconstructed, not supplied by a native trace.

## Scrolled-back reader

The follower previously retained numeric scrollTop only, with native anchoring
disabled. It now remembers the first visible caption node and its relative top
offset whenever the reader scrolls away from live. Updates/ResizeObserver restore
that offset, then refresh the anchor. Programmatic compensation does not switch
back to following or count translated rows as new captions. Deleted anchors are
discarded; Jump clears the anchor and resumes following.

Unit tests cover growth, repeated updates, new-caption counts, Jump, removal and
empty content. A real React/API fixture at 390×844, Large/42px, fills a very long
translation into caption 01 while reading caption 34: caption 34 remains visible,
offset -19.89→-20.21px, scrollTop 6489.38→13973.75, outer scrollY unchanged at 0.
The subpixel difference is below the browser check's 1px tolerance.

## Old v2 reload investigation

The historical a6c7843 generated worker registers /sw.js at scope /. Its
NavigationRoute uses createHandlerBoundToURL(index.html): a precache hit returns
immediately; a missing index cache entry falls through to Workbox's fetch with
no deadline. This is a reachable legacy fallback, but a missing cache entry in
the tester's real profile is **unverified**. Navigation preload is disabled in
the installed historical registration. Workbox contains preload support, but
that alone is not evidence it runs. The configured legacy routes match GET;
the app's translation POST is not intercepted/held by those routes.

`/home/ubuntu/browser-checks/v5-reload-stress.mjs` installs the actual generated
historical worker in isolated Chrome contexts and proxies to the current Node
server on ephemeral test ports, never the production ports. Results:

- With an actual handler request waiting on a delayed local throttling fixture,
  first normal reload 103ms; the old page POST aborts (`net::ERR_ABORTED`).
- After current worker activation, second normal reload 1236ms; history sentinel
  retained. This is counterevidence to one pending POST or ordinary v2 cache-first
  navigation alone explaining the 90-second stall.
- Current worker with intentionally held navigation: cached/offline shell in
  3103ms, using its existing 3s network timeout (unchanged config).
- Artificially delete only v2's cached index, hold its fallback response: reload
  remains pending beyond 3512ms and finishes in 3626ms after release. This proves
  the no-timeout fallback can wait; it is not the original intact-profile symptom.

The current Google handler already bounds fetch plus JSON/body processing to 6s.
OpenAI SSE uses 4s per-read timeouts and is not selected in the reported Google
configuration. Static paths all end responses; healthy chunked framing is valid,
not itself evidence of hanging. Baseline paused incoming POST remained open after
1s while an independent GET completed in 17ms: this verifies a paused-body path
without an adapter deadline (Node still has its defaults), but disproves it
automatically blocking unrelated navigation.

The Node adapter now adds a 30s whole-API deadline (receive/handler/stream), aborts
response sources on disconnect/deadline, returns typed retryable 503 before
headers, and terminates incomplete streams after headers. Static GET/HEAD bytes
are read before headers and carry exact lengths. Tests cover healthy/empty,
paused-body, never-returning handler and non-ending stream paths. These are
verified hardening targets, **not a confirmed fix for the 90s profile stall**.

No Clear-Site-Data/blanket unregister was added: there is no verified worker URL
mismatch, the active second-reload worker is unknown, and clearing origin storage
would risk the user's retained transcripts without proving the cause. The
original profile, its cache state and the report's linked navigation-event trace
are not available here. Discriminating evidence is a net-export/DevTools trace
from the stalled tab showing navigation queued/start/headers/body timing, active
worker version and pending fetches, plus whether its precached index exists.

## Online cooldown

0418f30's caption-state code needs no change. The zoom matrix asserts online
HTTP-429 cooldown shows “Translation service busy, retrying automatically”, with
no connection-wait/Interrupted text or manual Retry. The existing separate
recovery browser fixture is updated to assert that intentional lack of manual
Retry rather than clicking the obsolete control.
