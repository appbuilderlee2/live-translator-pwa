# Fast meeting follow-up

The supplied report covers 017e074 with instrumented Chrome and bypassed service
workers. Its synthetic-voice mic replays are not a test of this revision's native
recognition accuracy. Missing source turns and incorrect top recognition results
cannot be reconstructed by translation normalization.

## Figures and phrasing

Scaled English number words are converted to digits before translation on server
and local paths. Equivalent decimal Chinese currency scales are formatted after
translation: 十二點五百萬美元 becomes 1250萬美元. This does not alter the amount.
Unscaled dosage words and dates are left alone.

The exact caption-03 source is:

> the approved budget is 2.4 million US Dollars Revenue was 12.5 million last year this year revenue is 13.2 million US Dollars gross margin went down by 25 basis points net revenue retention must stay above 110%

The clause splitter and source-backed display formatter recognize the revenue,
year, margin and retention clause starts. Existing punctuation is preserved;
dependent-clause guards remain. Unintended zero-width spaces are removed from
Chinese output.

## Recognition warnings

Warnings now explicitly say the recognized figure itself may be wrong and ask
the user to check the audio. Actual numeric alternatives are retained in caption
metadata, saved history and export. They are candidates, not corrections.
The original event 36 chose 15.4M and supplied 50.4M as a disagreeing final
alternative, not 2.4M. The UI must not invent 2.4M from the test's source script.

## Latency measurements

Each row matches the last native final with the posted source, the request ID,
CDP loadingFinished, and first UI sample showing its translated Chinese. All six
Chinese samples were visible. Values are milliseconds, rounded to one decimal.

| Run / request | Final to POST | HTTP duration | Final to visible Chinese |
| --- | ---: | ---: | ---: |
| meeting-1 / 3726 | 2002.2 | 84.5 | 2098.1 |
| meeting-1 / 3727 | 2001.5 | 2091.3 | 4103.7 |
| meeting-2 / 3728 | 2001.2 | 1758.5 | 3765.0 |
| meeting-2 / 3729 | 2001.3 | 2216.4 | 4245.8 |
| clear-control / 3730 | 2002.7 | 77.6 | 2086.3 |
| exact-25-control / 3731 | 2001.4 | 2083.3 | 4092.0 |

The known settlement window accounts for 2000ms; the remaining pre-POST delay is
1.2–2.7ms of scheduling/queue overhead. None of these six requests has an observed
cooldown wait. HTTP time includes server/provider/network time: browser logs
cannot split these further. Response completion to UI sampling adds 5.3–28.1ms;
sampling is approximately 50ms, so these are not frame-accurate measurements.

The separate controlled 429 retries after 20.005 seconds, as requested by
Retry-After. Its subsequent new caption waits through conservative provider
pacing. This intentional cooldown is not reduced or confused with recognition
settlement. Both recovered Chinese rows were offscreen in the captured samples.

Complete sentence-punctuated finals now settle after 750ms unchanged, saving
1250ms. Unpunctuated finals still wait 2000ms, dangling fragments stay unready,
and revisions reset the hold. The six recorded finals are unpunctuated, so this
trace would not benefit from the new fast path. Native finalization delay and
missing speech remain outside this optimization.

## Layout

The transcript collapsed to 0px at 1034×673 CSS pixels, Large text and a visible
Jump control. The Jump control was below that collapsed pane, not geometrically
over it. The height budget previously reserved the composer but not a usable
transcript. A 180px floor and content-aware normal-flow composer prevent this
collapse when toolbar/actions/zoom consume the available height. Long bilingual
cards can still require scrolling; neither language is discarded or shrunk.
