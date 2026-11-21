# Traveler follow-up

The private speech trace has two departure finals and three phone-question
finals across the rapid runs. The fare is interim-only in the first two runs,
then overwritten at its result index by the phone question. The third run
contains only filler/blank results before the phone question: no departure or
fare transcript is available to recover. No application fix can reconstruct
speech Chrome never returned.

Replaying the result-index suffixes as cumulative result arrays preserves both
departures, both full fare interims, and all three phone questions. G's terminal
promotion now queues the retained fares as unconfirmed after listening stops;
they deliberately remain untranslated while provisional/listening. Synthetic
quick-turn tests additionally cover actual native fare finals and verify one
request per caption, retained source text and zero pending after Stop.

The standalone-fare trace records eight HTTP 502 `upstream_invalid_response`
responses. This establishes provider-result validation failure, not rejection
by the input validator. The precise upstream response/reason was not captured.
One reproducible candidate is losing the currency placeholder: `$25` becomes
`25 __CURRENCY_UNIT__`, and restoring plain `25` throws. This candidate is not
claimed as the observed provider's confirmed failure reason. Complete bare
currency literals now format deterministically to 元 in local dispatch and the
server, bypassing providers and their cooldowns. Explicit US amounts and mixed
sentences retain normal translation; bare $ is not inferred to mean USD.

Notifications formerly used a high-z-index fixed top-right overlay, which can
intercept History/header taps in portrait. They now occupy normal flow after
the workspace, and their height is reserved in transcript/composer layout.

The existing local seating check already rejects comfortable-place translations
without sitting. The network/client and both server provider completion paths
now enforce the same seating guard, preventing a bad fallback from being
accepted as complete. Currency-context punctuation repair removes a comma
between the amount and 元/美元, including recovered History output.

Coverage: `tests/traveler-017e074.test.mjs`; deterministic browser checks cover
quick-turn finals, standalone fare, local sitting fallback and portrait banner
hit targets. Private reports, raw traces and supplied screenshots are excluded
from the repository and release archive. Native-model/microphone behavior is
not claimed to have been replayed live.
