# Long lecture 017e074 follow-up

## Final captions

The request-count CSV identifies six native-final, zero-request captions. Five
end at artificial caption boundaries with `a`, `is`, or `the`; caption 84's actual
native final ends with `the`. The caption-08 screenshot shows the frozen fragment
ending `not a`, while the next caption starts `failure`. `metadata` applied the
unfinished-utterance guard to every artificial chunk, including interior chunks
covered by a longer native final. `reconcile` then refused to replace that
provisional fragment, and `flush` marked it forced. This path is reproduced by
the regression fixture; the supplied CSV does not establish every native event's
exact ordering.

Only the actual utterance tail is now held for completion. Ending a recognition
session re-evaluates native-final metadata and releases its remaining settle
hold. Final/end, end/final and network-error/end/final fixtures each drain four
captions exactly once. The browser fixture drains two final captions with two
requests. No-final saved interims remain explicitly unconfirmed and are not
silently promoted into native finals: the no-pending invariant covers captions
with native finals, not captions 61/62/82 with no mapped final or unmapped 83.

## Reading anchor

The old anchor chose the first intersecting article, even when only its bottom
padding or a sliver of its placeholder remained above the next visible caption.
Growing that article leaves its top unchanged, so preserving that top does not
preserve the next caption. The follower now anchors visible caption content,
preferring a fully visible starting edge over an almost-scrolled-away fragment.
The browser check adds normal UI, 390x844, 42px, caption 53 read 25px below the
pane top while caption 52 receives a large translation. Existing Large/caption-34
and all layout combinations remain in the check.

## Microphone recovery

An error can set `retrying` while the recognizer continues producing results.
The old result handler cleared the error text but never restored `listening`;
the closing-session early return also skipped retry reset. All nonempty results
now restore listening and cancel retry timers before either session branch.
Start/audio-start clear stale notices even after prior failures, without resetting
the backoff counter prematurely. Empty sessions still produce no work.

## Lecture phrasing

Caption 09's source contains explicit section-ending, topic-introduction, solar
panel and school clauses. Source-backed patterns separate those Chinese starts
into five sentences, without changing the provider's words. Existing punctuation
is idempotent; dependent-clause guards and figure formatting remain in effect.
