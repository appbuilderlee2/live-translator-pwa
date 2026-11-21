# Native desktop Chrome replay of 8f9be9f

## Setup and scope

Tested the production App at `http://localhost:3002` without stopping or
restarting its server (PID 44218). Attached to the already-running desktop
Chrome 156/profile over CDP on port 29229; did not launch another browser or
use headless mode. The test used native Web Speech, native result events,
and real server translations, without injecting recognition results.

The exact PulseAudio routing was:

```sh
pactl load-module module-null-sink sink_name=fake_mic
pactl load-module module-remap-source master=fake_mic.monitor source_name=fake_mic_src
pactl set-default-source fake_mic_src
paplay --device=fake_mic speech.wav
```

Played the existing `traveler.wav` and `meeting.wav` once each, with eight
seconds after playback for final results/translation. These are the previously
reconstructed eSpeak WAVs, not the unavailable original tester recordings.
Chrome's native `start`, `result`, `end`, and error events and calls to
`start()`, `stop()`, and `abort()` were recorded. Instrumentation delegated to
the original methods without changing their behavior. The microphone start
configuration was `continuous=true`, `lang=en-US`, `maxAlternatives=3`.

The served index matched the current production `dist/index.html`:

```text
index.html SHA256: 1be50217e4518e31688cb13b96eb2d6db0543d1949778ad6a18b3b443ef0d822
index-vhOm7Psk.js SHA256: 5df2e92d560e79b82800acf3671c5d6db00187490ba3fa4062d2d3a04f83ffcb
```

## Native lifecycle results

Counts below exclude the final explicit user Stop used to end each test.

| Replay | Observation | start() | stop() | abort() | Native ends | Result events | Errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Traveler | 22.245s | 1 | 0 | 0 | 0 | 36 | none |
| Meeting | 64.994s | 2 | 0 | 0 | 1 | 181 | none |

Traveler had no restart gap. Meeting had one natural end: the restart
`start()` call occurred in the same millisecond (0ms dispatch gap), and the
next native `start` event followed 5ms later. Its two start calls were
64.094 seconds apart; that is session duration, not a 64-second outage.
The concluding user Stop added exactly one `stop()` call per replay and no
`abort()` calls.

## Committed traveler captions

Exactly three segments, one per turn:

1. EN: `nothing waiting at 6:30`
   ZH: `6:30 沒有等待`
2. EN: `the tickets cost $1.25`
   ZH: `門票價格為 1.25 美元`
3. EN: `can I pay with my mobile phone`
   ZH: `我可以用手機支付嗎`

`6:30` survived. `$25` **did not**: Chrome's top final was `$1.25`, with
confidence 0.8745; the other alternatives included `a dollar 25` and
`scholar 25`. The committed price caption had both `alternatives` and
`interim` numeric warnings. `mobile phone` occurred exactly once, with no
duplicated phone suffix. The first turn's subway wording was misrecognized.

## Committed meeting captions

Exactly four segments:

1. EN: `Mario and wheels in the morning back on June 15th the market is 2.4 million US Dollars purple Lantern`
   ZH: `瑪利歐與輪子早盤6月15日上市 紫燈籠240萬美元`
2. EN: `Mike and fears from 12.5 million to 13.2 million US dollars not 30.2 million keep the forecast`
   ZH: `麥克和擔憂保持預測不變，從 1250 萬美元到 1320 萬美元，而不是 3020 萬美元`
3. EN: `Hollywood 25 basis points not 25% don't talk the renewal until procurement signs often July 23rd Golden Bridge`
   ZH: `好萊塢 25 個基點而不是 25% 在 7 月 23 日 Golden Bridge 經常簽署採購協議之前不要談論續約`
4. EN: `you'll come back here from Augustine to August 19th Revenue retention about 110% and take the rest of`
   ZH: `從奧古斯丁到 8 月 19 日你會回到這裡 收入保留大約 110% 並拿走剩下的`

| Required content | Native English / Chinese result |
| --- | --- |
| 2.4M | Present / 240萬 |
| 12.5M | Present / 1250萬 |
| 13.2M | Present / 1320萬 |
| 25 basis points | Present / 25 個基點; distinct from the spoken correction 25% |
| July 23 | July 23rd / 7 月 23 日 |
| Aug 19 | August 19th / 8 月 19 日 |
| above 110% | **Not faithful:** `about 110%` / `大約 110%` |

All four meeting captions carried interim-number warnings. The final
retention caption also carried an alternatives warning: Chrome offered
110% and 100% alternatives. Numbers survived much better than names,
business wording, and complete decisions. August 9, the go-live wording,
`flat`, and `take the rest offline` were not preserved in Chrome's top finals.
`keep the forecast flat` was present in a lower-ranked alternative, but not
the selected top final; the app does not choose alternatives based on the
known test script.

## App preservation versus recognizer accuracy

For each replay an assertion joined every top-ranked native final and
compared it to all newly committed English captions, trimming only the
leading/trailing whitespace of each native result. Both comparisons passed:

```text
traveler: committed English equals all native top-ranked finals exactly; 3 segments; no app-side dropped or duplicated text
meeting: committed English equals all native top-ranked finals exactly; 4 segments; no app-side dropped or duplicated text
end → next start() call (ms): [ 0 ]
end → next start event (ms): [ 5 ]
```

This rules out the controller dropping or duplicating top-final text in
these two runs, but does not establish general recognition accuracy or
perfect interim-caption behavior. The observed missing/garbled wording
already exists in the raw native finals. No application bug requiring a
code change was demonstrated, and no scripted correction was added.
This successful configuration changes both the browser/profile and audio
routing from the previous failed experiment; it does not isolate which
change resolved the earlier `audio-capture` failures.

## Checks, cleanup, and evidence

```text
npm test
ℹ tests 29
ℹ pass 29
ℹ fail 0
```

Restored `devin_output.monitor` as the default source and unloaded both
test modules. The original Chrome and port 3002 server remained running.

Machine-local raw evidence (not fixtures or synthesized result data):

- `/home/ubuntu/browser-checks/audio/desktop-traveler-result.json`
- `/home/ubuntu/browser-checks/audio/desktop-meeting-result.json`
- `/home/ubuntu/browser-checks/audio/desktop-native-replay.log`
- `/home/ubuntu/browser-checks/desktop-native-replay.mjs`
- `/home/ubuntu/screens/desktop-traveler-native.png`
- `/home/ubuntu/screens/desktop-meeting-native.png`

The helper's restart-gap calculation was corrected after capture to count
a same-millisecond restart as zero rather than omitting it; raw events were
not changed, and neither replay was repeated.
