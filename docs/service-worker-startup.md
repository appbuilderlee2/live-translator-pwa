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
the client detects abnormally slow worker startup or a long small-document
fallback. It requests an update, then registers a fresh script URL at the same
root scope with `updateViaCache: none`. It does not unregister, clear caches,
delete transcripts, reload the page, or wait for `serviceWorker.ready`.
Each operation has a four-second application-side deadline; browser jobs cannot
be cancelled by that deadline. Recovery attempts are limited to once per minute
across tabs when local storage is available. Ordinary loads register `/sw.js`.

This timing heuristic may also match a genuinely slow small-document body; the
consequence is a bounded worker refresh, not loss of stored data. Static routing
requires one successful installation of the updated worker. Offline operation
still needs a running worker and a previously cached shell. A permanently broken
browser registration/update subsystem cannot be repaired by page JavaScript.

Use the original affected browser to verify recovery from a native script-cache
or streaming failure. A synthetic slow-start worker demonstrates the navigation
dependency and static-route bypass, but does not reproduce that internal defect.
Do not commit browser profiles, private traces, net-exports or storage dumps.
