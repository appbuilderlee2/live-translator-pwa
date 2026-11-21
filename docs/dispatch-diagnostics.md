# Translation dispatch diagnostics

Diagnostics are off by default. To enable them before a microphone replay, run
`localStorage.setItem('lt-dispatch-diagnostics', '1')` in this app's browser console,
then reload. The preferences area shows **下載派送診斷 / Download dispatch diagnostics**.
Download after the queue drains, or while a suspected early request is visible.

The JSON contains the latest 500 dispatches: timestamp, persistent caption ID,
source, provisional/forced/settled/unconfirmed flags, recognition session ID,
caption word range, final ranges (including saved rather than native ranges),
terminal state, eligibility reason, retry status and translation context.
Typed input and legacy captions without captured recognition evidence have null
evidence; a readiness reason describes the app's eligibility decision, not an
independent assertion that Chrome delivered a native final.

This is a private diagnostic: it contains transcript text and context. Nothing is
uploaded automatically. Do not commit or include exported JSON in release archives.
Records survive reload; storage refusal never blocks translation. Disable with
`localStorage.removeItem('lt-dispatch-diagnostics')`; erase the log with
`localStorage.removeItem('lt-dispatch-log')`. Captured evidence on transcript entries
remains until those conversations are deleted.

## Short lecture formatting

Source-backed lecture boundaries run independently of the general length gate.
The recognizer's complete native final supplies any word used to extend a caption
past a dangling determiner or `a better`; neither providers nor the application
invent the missing noun. Only held, untranslated caption boundaries are extended
during reconciliation. Already translated captions are not repartitioned.
