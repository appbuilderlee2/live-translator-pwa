# Traveler rerun

Recognition regression coverage uses synthetic result-index suffix replacement
and restart ordering: retain observed departure/fare turns when the fare index
is reused for payment, and do not reconstruct absent turns from payment-only
results. It contains no private raw trace. The per-run evidence analysis and
full private replay stay outside the repository.

The relevant HTTP failure is `upstream_invalid_response`, not the 400 input
validator. An isolated seating question can fail too; sentence splitting alone
cannot repair that semantic omission. In this implementation Google validation
fails before HTTP headers; OpenAI completion validation fails after streaming
HTTP 200. Historical provider identity requires server environment/log evidence,
not just a client HTTP status.

A live Google request for the isolated seating question reproduces the omission:
`地鐵站附近有舒服的地方嗎？`. Rephrasing the explicit English sitting location as
`comfortable seat` yields `地鐵站附近有舒服的座位嗎？`. A live full-passage probe with
the canonical seating phrase also retains the neutral-currency placeholder and
the final train question. The Google request path now performs that conservative
English canonicalization before translation. It preserves singular/plural and
does not rewrite dependent waiting/coordination clauses. All original-source
seating, negation, medication and currency validation remains in place. This
avoids repeatedly sending the same deterministically lossy query without
inventing Chinese meaning or adding unpaced provider retries. Sentence splitting
alone would not repair the isolated seating sentence.

Invalid translations previously had individual retry deadlines; newer ready
entries could bypass the oldest. The queue now uses one persisted global
backoff and always selects the oldest eligible committed caption, including
when it is being retried. New English captions still appear immediately in
source order, but their translation waits. A permanently failing provider can
therefore hold the backlog; this is intentional and matches “oldest first”.
Non-retryable failures release the queue rather than blocking it forever.

Coverage: `tests/traveler-rerun.test.mjs` and the updated queue policy test in
`tests/provider.test.mjs`. Private raw traces, browser fixtures and screenshots
remain outside the repository and release archive.
