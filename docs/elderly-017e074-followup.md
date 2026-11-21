# Elderly reader 017e074 follow-up

The medication example retains its dosage/negation. Its remaining defect was
instruction boundaries, not a new dosage correction. Display phrasing now
separates the source-backed 24-hour limit, pre-medication pharmacist instruction,
and dose-confirmation request. Count/noun whitespace is removed for medicine
classifiers, including restored history. Existing 603ebad source-count correction
still handles medicine quantities. An idempotence regression prevents a second
formatting pass from splitting the digits of 24.

Physical `community centre/center` context corrects 社群中心/社區中心 to
社區活動中心; a source-backed community walking activity becomes 健走活動.
Online/virtual/digital centres and unrelated walking routes are not rewritten.
The shared traditional formatter receives source on provider/local/client/history
paths from the edge/history correction.

The recognizer's 30-word chunk boundary could end immediately after `please`.
New chunks move that word to the following instruction. Final reconciliation
also repairs the boundary when a paused interim already published it. Chinese
`請。` immediately preceding another Chinese instruction is joined instead of
retaining a lone politeness sentence. This does not reassign words between
already-saved independent history records or remove a genuine quoted use of 請.

Regression tests cover the exact medication output, idempotence, empty output,
physical versus online community contexts, walking-route exclusions, orphan
politeness joins and paused/unpaused native-result boundaries. The browser
fixture renders restored medication and community captions at 42px.
