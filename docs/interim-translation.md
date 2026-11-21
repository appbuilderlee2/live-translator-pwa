# Interim translation investigation

## Evidence from 31291ad

There are no tester events, so the actual Chrome isFinal flag and provider at 71.5s are unknown. The supplied times alone cannot identify what happened. The strongest verified reachable path is **provisional speech promoted into the committed-caption queue**, not the disabled preview effect:

* `src/main.tsx:177–179`: the interim effect only clears preview; no local or network translation call. `:183` wires speech preview to setInterim (English only). This disproves a still-running UI preview translator in this revision. Direct `localTranslation(..., {preview:true})` was not rejected, but no UI caller exercised it.
* `src/speech.mjs:181–182`: after 1200ms without a text change, call stable(current, true). `:118–129` publishes the common interim words. `:63–65` marks them provisional; `:68–76` nevertheless calls commit.
* `src/main.tsx:147–154`: commit inserts **every** segment and calls run. `:132–143`: execute does not check provisional/forced; it translates normally, writes zh, then status done. Local-first dispatch is in `src/local.mjs:43–51`. The queue also did not filter provisional or forced captions. Therefore a purely interim result can be translated on either provider path without setting preview:true.
* A second reachable path is a genuine Chrome final: `src/speech.mjs:104–105` publishes finals immediately. There was no settlement delay; a premature Chrome final could translate before an extension. No evidence establishes that Chrome did this in the tester's session.
* `src/speech.mjs:132–138`: end/Save flushing retains unfinished interim text as forced/provisional, which reached the same unguarded normal queue. Long stable prefixes (`:119`) could also publish before final recognition. These are additional reachable variants, not proven events from this report.

Actual historical controller replay with synthetic input (current local translator replaced with deterministic output; **not** a native/provider reproduction): emit only `my blood pressure was`, isFinal:false, at 70.3s; advance the clock 1200ms. Output:

```json
{"commits":[{"at":71500,"text":"my blood pressure was","provisional":true,"forced":false,"numericWarnings":[]}],"calls":["my blood pressure was"],"displayed":"我的血壓是"}
```

This proves Chrome finalization is **not necessary** to produce the symptom. It does not prove this was the tester's exact sequence. Raw SpeechRecognition result arrays/isFinal values and local/API call timestamps would discriminate it from the premature-final path.

## Fix

English provisional text remains preserved for no-loss reconciliation, but provisional/forced/unsettled speech cannot enter or execute in the translation queue, display Chinese, advertise Translated, replay Chinese or export an old provisional translation. Restored older provisional Chinese is discarded while preserving English. Preview mode rejects before either the local Translator API or fallback; network and server preview guards remain.

Chrome-final captions must remain unchanged for 2000ms before translation. Text/finality changes reset readiness and abort active translation; stale stream updates are ignored. Obvious trailing function-word fragments such as `my blood pressure was` remain provisional even if Chrome calls them final. A continuation in the same result index, or a new final row following that dangling fragment, revises the same caption before settlement. This adds translation latency, not a microphone-restart delay.

On reload, a saved **complete Chrome-final** caption may resume because its old recognition session has ended. Provisional/forced/incomplete captions stay English-only. The incomplete-sentence heuristic is conservative, not a general grammar parser. The 2s window is not a promise that Chrome can never revise arbitrary text later; revisions invalidate the prior output. No audio buffer or microphone recovery change is claimed.

`tests/speech-translation.test.mjs` exercises local, Google and OpenAI fixtures for an interim, a premature final, and split final rows: no translation at 71.5s or 73.3s; one full 140/90 translation at 75.3s. It also covers explicit preview rejection, end/Save retention, old translated-interim restoration/export, queued readiness invalidation and complete-final reload recovery. No actual native microphone/provider session was reproduced, and the UI changes were not visually verified.
