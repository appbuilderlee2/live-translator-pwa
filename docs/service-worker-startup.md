# Navigation when a service worker cannot start

A service worker can be activated without currently running. Chrome must normally
start it before dispatching a controlled navigation's fetch event. A browser-side
script-streaming startup failure can therefore delay the page even when the
server has already returned a complete response. Navigation Timing alone can
misidentify this as a slow response body: compare actual response event delivery,
worker lifecycle/errors, and network byte receipt times before assigning cause.

The worker imports the small `sw-navigation.js` install listener. Where
`InstallEvent.addRoutes` supports `race-network-and-fetch-handler`, navigations
race the network independently of worker startup. The existing Workbox
NetworkFirst handler retains cached/offline fallback. Unsupported browsers keep
that handler unchanged. API and asset requests are not statically routed.

The worker still uses immediate activation and client claiming. Its generated
main script is about 10 KB, with the Workbox runtime in a separate imported file;
no application or translation code is included. Large application bundles are
precache URLs, not inlined worker scripts.

An already-installed worker cannot acquire new static routes retroactively.
After the first successful page load (potentially after one old-worker timeout),
the client detects abnormally slow worker startup or the approximately 90-second
small-document fallback signature. Static network-routed navigations never
trigger recovery. It registers a stable build-derived script URL at the same
root scope with `updateViaCache: none`. It does not unregister, clear caches,
delete transcripts, reload the page, or wait for `serviceWorker.ready`.
Each operation has a four-second application-side deadline; browser jobs cannot
be cancelled by that deadline. Recovery is recorded before registration and
limited to one attempt per build across tabs and reloads. If local storage is
unavailable, automatic recovery is skipped rather than creating unbounded jobs.
Ordinary loads retain an existing active, installing or waiting registration;
only an unregistered scope registers `/sw.js`. Browser-managed update checks
continue normally. Recovery never queues both an update and a URL replacement.

This timing heuristic may also match a genuinely slow small-document body; the
consequence is one bounded worker refresh per build, not loss of stored data. Static routing
requires one successful installation of the updated worker. Offline operation
still needs a running worker and a previously cached shell. A permanently broken
browser registration/update subsystem cannot be repaired by page JavaScript.

Use the original affected browser to verify recovery from a native script-cache
or streaming failure. A synthetic slow-start worker demonstrates the navigation
dependency and static-route bypass, but does not reproduce that internal defect.
Do not commit browser profiles, private traces, net-exports or storage dumps.

The 0440d4f follow-up disproves repeated slow-start detection as the cause of
normal-load churn: pickup took 90,498ms, but the next loads took 429ms and 265ms
and matched static routing. Pickup created version 8 (`/sw.js`) through update,
then version 9 (`/sw.js?recovery=1795296433472`). The next healthy load registered
canonical `/sw.js` again, creating version 10. It remained new/starting during
the 45-second follow-up; the final registration still had activated version 9
and no installing/waiting worker. Thus the verified churn is a URL reversal,
not evidence that every healthy load generated another timestamped URL. The
underlying native Script-streaming defect remains outside the reproduction.
