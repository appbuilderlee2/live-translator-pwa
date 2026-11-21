# Edge/history follow-up on 6939856

## Medicine counts

The clean-reload trace in medical-clean-control.json records local inputs
`Take two medicine pills.` and `My blood pressure is 140/90.`, with raw output
`服用兩種藥丸。` and `我的血壓是 140/90。`. The 603ebad correction already maps
that output to `服用兩顆藥錠。 我的血壓是 140/90。`. Its after-breakfast control
also already changes 兩片藥錠 to 兩顆藥錠. New exact-caption fixtures exercise
local, Google, character-streamed OpenAI and cumulative client normalization,
typed and spoken. Expanded classifier handling covers the report's separate
server output 兩塊 藥錠; explicit kinds/types remain 種.

## Platforms

Numbered platforms are formatted as 6號月臺 only when the original English
mentions that platform number in a railway or wayfinding context. Explicit
computing, launch, stage/concert, oil/drilling and political contexts are excluded.
This is source-backed
terminology correction, not an unconditional 平臺 replacement. Server streaming,
local, cumulative client and restored-history output share the correction.

## Waiting coverage

The supplied local chunk contains the entire phrase `a comfortable place to sit
while we wait`; its output ends at `一個舒適的地方來坐`. Thus chunking did not
remove the waiting phrase before the model. The coverage dictionary checked
seating but not waiting. Generic wait/await coverage now rejects this omission
before displaying local output and falls back once with the full original
caption. Both the exact long paragraph and short control are tested. This is
a conservative concept check, not a guarantee of every temporal clause's scope.

## Local invocation counts

The archive supplies actual inputs, outputs and timing in native-long-live.json
and live-request-summary.json. Every observed input was compared with current
`localChunks(normalizeMedical(protectCurrency(normalizeBusiness(currencySource(source, true))).text))`.

| Caption | Observed calls | Current chunks | Exact input matches | Duplicate inputs |
| --- | ---: | ---: | ---: | ---: |
| Taiwan visit | 3 | 3 | 3 | 0 |
| Tickets / family | 3 | 3 | 3 | 0 |
| Hospital | 3 | 3 | 3 | 0 |
| Library / park | 3 | 3 | 3 | 0 |
| Train / platform | 4 | 4 | 4 | 0 |

All 16 calls occurred after a final; starts were 2001–2124ms after the corresponding
final. Calls are serial, unique clause/120-character chunks, not retries or
settlement re-dispatches. A typical three-chunk caption stays 3→3 and the train
regression stays 4→4; a short greeting uses one call. No deduplication change is
warranted by these traces. The hospital omission now deliberately triggers one
server fallback after the local coverage failure. Arbitrarily merging chunks
would remove the existing safeguards against local truncation/negation loss.

## Punctuation

The ticket caption's first 120-character chunk ends at `main entrance`; its next
chunk starts `we have`, not previously a recognized sentence boundary. The join
therefore emitted a space, and the Chinese formatter did not recognize `我們有`
or whitespace at a boundary. Source-backed display formatting now changes
`主入口 我們有兩個成人…` to `主入口。我們有兩個成人…`, without extra model calls.
Existing clause patterns also accept inter-clause whitespace. Existing Chinese
punctuation, dependent speech and numeric punctuation are preserved; arbitrary
120-character cuts still do not automatically become full stops. Missing source
question marks are not guessed from polite wording alone.
