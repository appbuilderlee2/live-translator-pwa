import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readableChinese } from '../shared/phrasing.mjs'
import { networkTranslation } from '../src/network.mjs'

const source = 'conditions the same recording result carefully makes the experiment easier to repeat a surprising result is not a failure it is a reason to ask a better question this is the end of affectionate'
const firstSource = 'Section 8 today we are discussing scientific experiment a scientific experiment begins with a clear question we change one factor and keep the other'
const firstChinese = '第8節。今天我們討論科學實驗。科學實驗從一個明確的問題開始。我們改變一個因素並保留另一個因素。'
const captured = '相同的記錄結果。仔細地使實驗更容易重複。令人驚訝的結果不是失敗。它是提出更好問題的理由。這是深情的結束。'
const beforeRule = captured.replace('記錄結果。', '記錄結果 ')
const expected = '相同的。記錄結果 仔細地使實驗更容易重複。令人驚訝的結果不是失敗。它是提出更好問題的理由。這是深情的結束。'

for (const run of [1, 2, 3]) test(`exact section-8 run ${run}: recording phrase is not split by the formatting rule`, () => {
  assert.equal(readableChinese(firstSource, firstChinese), firstChinese)
  for (const complete of [true, false]) {
    assert.equal(readableChinese(source, beforeRule, complete), expected)
    assert.equal(readableChinese(source, expected, complete), expected)
  }
  assert.equal(expected.replace(/[。\s]/g, ''), captured.replace(/[。\s]/g, ''))
})

const prefix = 'Section 8 today we are discussing scientific experiment'
const rest = ' a scientific experiment begins with a clear question we change one factor and keep the other conditions the same recording result carefully makes the experiment easier'
const unconfirmedChinese = '第8節。今天我們討論科學實驗。科學實驗從一個明確的問題開始。我們改變一個因素並保持其他條件相同仔細記錄結果使實驗變得更容易。'
const unconfirmedExpected = unconfirmedChinese.replace('條件相同仔細', '條件相同。仔細')

for (const ending of ['', 's']) test(`exact unconfirmed prefix with experiment${ending} repairs the no-space join`, () => {
  for (const complete of [true, false]) assert.equal(readableChinese(prefix + ending + rest, unconfirmedChinese, complete), unconfirmedExpected)
})

test('recording boundary is source-gated and leaves ambiguous Chinese and existing punctuation alone', () => {
  for (const english of ['We keep conditions the same and record results carefully', 'We keep conditions the same by recording results carefully', 'Recording results carefully is useful', '']) {
    assert.equal(readableChinese(english, '條件相同仔細記錄結果。'), '條件相同仔細記錄結果。')
  }
  for (const chinese of ['相同的記錄方式仔細地改善實驗。', '條件相同，而且仔細記錄結果。', '條件相同。仔細記錄結果。', '相同的條件讓我們仔細記錄結果。', '']) {
    assert.equal(readableChinese(source, chinese), chinese)
  }
  assert.equal(readableChinese(source, '條件不變 記錄數據很重要。'), '條件不變。記錄數據很重要。')
})

test('byte-split responses preserve recording boundaries for full and unconfirmed sources', async t => {
  for (const [english, chinese, output] of [[source, beforeRule, expected], [prefix + rest, unconfirmedChinese, unconfirmedExpected]]) {
    const bytes = new TextEncoder().encode(chinese)
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    } })))
    const updates = []
    assert.equal(await networkTranslation(english, new AbortController().signal, text => updates.push(text)), output)
    assert.ok(updates.every(text => !text.includes('記錄結果。仔細')))
    t.mock.restoreAll()
  }
})
