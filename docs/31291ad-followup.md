# Follow-up to the edge and elderly 31291ad reports

Base: 149c4bd. Production servers are deliberately left unchanged.

## Request counts

The reports concern 31291ad, before 149c4bd's readiness gate. The reported
provisional publications could enter its ordinary committed queue; a false preview
flag was not evidence of final recognition. See `interim-translation.md` for the
historical call chain. The existing local/Google/OpenAI timeline tests exercise
the actual controller and provider boundaries.

The new edge replay drives the actual controller through the reported fragment
ending “I would like to buy” and the completion ending “before the museum opens”,
using both reported gaps (7.22s and 5.60s; second-run probe at 9.65s).
The elderly queue replay uses all seven published caption IDs and exact relative
times from the request table, including the double-provisional pattern. Thirteen
final-only controls complete its twenty-caption fixture. The reports' linked raw
native/request JSON files are not present in this environment, so these are
report-derived state/timing reconstructions, **not a full native-event replay**.
Neither their unreported interim times nor all twenty actual caption texts can
be recovered from the Markdown alone.
The report does not identify which ID had two provisional requests; that pattern
is assigned to a representative pair in the fixture, not asserted as its actual
ID/state association.

A remaining reachable duplicate on 149c4bd was found by inspection: an already
translated caption could regress to unready recognition, clearing its Chinese;
when the same source settled again it would retranslate. The app now retains the
last successfully completed source/translation pair, hides it while unready, and
restores it only when that same source settles. Whitespace/trailing full-stop
changes reuse it too; question marks and changed figures are not equivalent. The pair persists through saved/current history
reloads. Streaming fragments are never cached as completed translations.

Successful unchanged final captions get one dispatch in these fixtures. Genuine
content changes still need a fresh translation; failed requests still retry.
Exactly-once HTTP delivery across a browser crash during an in-flight request is
not guaranteed. No client can know whether an unacknowledged request completed.

## Accurate waiting states

`captionState` replaces the unconditional pending→connection and error→Interrupted
labels. Online queued work says waiting for translation; provider cooldown says
the service is busy and retries automatically. Offline work alone says waiting
for connection. Only explicitly non-retryable failures expose manual Retry.
Tests cover empty queues, pending/error cooldown, offline and recovered states.

## Contextual USD and subway

The reports tested 31291ad, predating e3512e8. Its shared fixes are reachable in
current Google, OpenAI, local and cumulative client normalization. New exact
context tests check all three currency sentences together, each local chunk,
character-streamed OpenAI output and final client updates, typed and spoken.
Existing exact generic-subway tests cover the same paths. No further currency
or Taiwan terminology rewrite was needed. Provider/model behavior is fixture
tested, not a new live Google/OpenAI/Chrome-model run.

## Hospital seating

On 149c4bd the normalized exact source is unchanged. Its local chunks were:

1. `the weather is warm today but it may rain later in the afternoon I would like to take a taxi to the hospital my friend`
2. `needs some water and a comfortable place to sit while we wait`

Thus preprocessing does not delete “sit” or split that phrase. The reported clean
local run had zero server requests; its wrong output therefore passed the local
model + normalization + coverage path, not the server provider. A native-model
omission is consistent with the evidence, but the actual raw model chunks are
unavailable, so the model-versus-chunk-context cause is not conclusively isolated.
The old coverage dictionary did not check seating, allowing this loss. The shared
coverage check now conservatively requires 坐/座位/就座/落座 for sit/sitting/seating/
seat. Missing meaning rejects local output before display and sends the complete
original caption to the server. It never fabricates a seating clause. Tests use
the exact paragraph and unrelated sitting/seat controls.

## Readable Chinese

The reported family Chinese is tested verbatim. Its English source comes from
Appendix A paragraph 5 of the elderly v3 report; the 31291ad report references
that fixture but does not attach its exact recognized text. Tests cover both
punctuated source and an unpunctuated/lowercase reconstruction.

Local translation now also recognizes independent “I would like”, “my friend
needs”, “we can”, and “there are” clause starts, without splitting after common
dependency words such as “hope” and “because”. Actual sentence/clause boundaries
gain 。 when the model omits it; arbitrary 120-character cuts do not. Cumulative
network/local display formatting inserts sentence boundaries before source-backed
我想/我的朋友需要/我們需要/我們可以/我們能夠 and 有…人來 in long/multisentence output and adds final punctuation.
Existing commas and punctuation remain intact; numbers, times and units are not
rewritten. Saved/current transcript recovery also applies display formatting.
This is deliberately conservative, not a general Chinese grammar
restorer. It cannot infer every missing boundary or guarantee natural prose.

No new microphone or native-model replay, visual check or production-server
change is part of this follow-up.
