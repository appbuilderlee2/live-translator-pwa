# Terminal held speech

Chrome may end recognition without emitting a native final. Previously these
captions remained provisional/forced forever and could not enter the queue.

The speech controller now retains ended recognition sessions until listening
ends. Automatic restarts still hold interim text. User Stop or a terminal
permission error promotes held captions after the existing 250 ms late-result
grace period, with `unconfirmed: true`, `settled: true`, and provisional/forced
cleared. The normal translation queue supplies ordering, cooldown and retries.
Empty sessions create no work.

The transcript exposes “辨識未確認 / Unconfirmed recognition” as a note with
zh-Hant-TW and English language spans. Current/history persistence and exports
retain the marker. Successfully completed translations remain done after
reload/reopening and are not queued again. Actual translation failures or
offline work remain accurately marked pending in addition to unconfirmed.

A matching late final clears the uncertainty marker without replacing the
caption ID or requesting its completed/in-flight translation again. A trailing
full stop is source-equivalent; substantive source corrections retain the
normal revision/retranslation behavior. Reload during an unfinished request
still uses the normal retry behavior; no cross-reload HTTP exactly-once
transaction guarantee is claimed.

Coverage: `tests/unconfirmed-speech.test.mjs` exercises multiple automatic
restarts, terminal stop/permission errors, queue drain, persistent recovery,
late finals before and after translation completion, and empty/error export
states. Browser coverage exercises live provisional suppression, stop, late
final, accessible labels, History, Copy/Download, and reload deduplication.
