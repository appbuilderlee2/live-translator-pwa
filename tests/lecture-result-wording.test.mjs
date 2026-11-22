import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readableChinese } from '../shared/phrasing.mjs'
import { traditional, translationBuffer } from '../shared/traditional.mjs'
import { networkTranslation } from '../src/network.mjs'

const source = 'recording result carefully makes the experiment easier to repeat a surprising result is not a failure it is a reason to ask a better question this is the end of Section 8'
const raw = '仔細記錄結果使實驗更容易重複 令人驚訝的結果並不是失敗，而是提出更好問題的理由。這是第 8 節的結尾。'
const expected = '仔細記錄結果使實驗更容易重複。令人驚訝的結果並不是失敗，而是提出更好問題的理由。這是第 8 節的結尾。'

test('result clause boundaries accept provider negation variants and adjective result starts', () => {
  assert.equal(readableChinese(source, traditional(raw, source)), expected)
  assert.equal(readableChinese(source, expected), expected)
  for (const adjective of ['surprising', 'unexpected', 'new']) {
    const english = `We completed the experiment the ${adjective} result is useful`
    assert.equal(readableChinese(english, '我們完成了實驗 意外的結果是有用的'), '我們完成了實驗。意外的結果是有用的。')
  }
  assert.equal(readableChinese('We know the surprising result is useful', '我們知道令人驚訝的結果是有用的'), '我們知道令人驚訝的結果是有用的')
  assert.equal(readableChinese('An unrelated short source', raw), raw)
  assert.equal(readableChinese(source, ''), '')
})

test('split provider chunks preserve the complete source-backed wording and sentence breaks', () => {
  let output = ''
  const buffer = translationBuffer(chunk => { output += chunk }, source)
  for (const char of raw) buffer.push(char)
  buffer.finish()
  assert.equal(readableChinese(source, output), expected)
  assert.equal(readableChinese(source, traditional(raw, source), false), expected)
})

const run1Source = 'conditions the same recording result carefully makes the experiment easier to repeat a surprising result is not a failure it is a reason to ask a better question this is the end of affectionate'
const run1 = '相同的記錄結果 仔細地使實驗更容易重複。令人驚訝的結果不是失敗 它是提出更好問題的理由。這是深情的結束。'
const run1Expected = '相同的記錄結果。仔細地使實驗更容易重複。令人驚訝的結果不是失敗。它是提出更好問題的理由。這是深情的結束。'
const run2Source = run1Source.replace('affectionate', 'Section 8')
const run2 = '令人驚訝的結果不是失敗。這是提出更好問題的理由。'

test('live negative/affirmative clauses gain only missing punctuation; punctuated run 2 stays unchanged', () => {
  assert.equal(readableChinese(run1Source, traditional(run1, run1Source)), run1Expected)
  assert.equal(readableChinese(run1Source, run1Expected), run1Expected)
  assert.equal(readableChinese(run2Source, run2), run2)
  assert.equal(readableChinese(run1Source, run1, false), run1Expected)
  assert.equal(readableChinese(run1Source, ''), '')
  const withoutPunctuation = text => text.replace(/[。 ，\s]/g, '')
  assert.equal(withoutPunctuation(run1Expected), withoutPunctuation(run1))
})

test('negative/affirmative punctuation generalizes without altering unrelated clauses', () => {
  const english = 'This is not an accident it is a deliberate choice'
  for (const next of ['它是', '這是', '而是']) {
    assert.equal(readableChinese(english, `這不是意外 ${next}刻意的選擇。`), `這不是意外${next === '而是' ? '，' : '。'}${next}刻意的選擇。`)
  }
  assert.equal(readableChinese('This is not a serious error it is a useful lesson', '這並不是嚴重的錯誤 而是有用的教訓。'), '這並不是嚴重的錯誤，而是有用的教訓。')
  for (const unrelated of ['It is a reason to ask a better question', 'This is not a failure because it is incomplete', 'This is not a failure and it is incomplete']) {
    assert.equal(readableChinese(unrelated, '這不是失敗 它是提出更好問題的理由。'), '這不是失敗 它是提出更好問題的理由。')
  }
  assert.equal(readableChinese(english, '這不是意外 我們做了選擇。'), '這不是意外 我們做了選擇。')
  assert.equal(readableChinese(english, '這不是意外。這是選擇。'), '這不是意外。這是選擇。')
  assert.equal(readableChinese(english, '這不是意外，這是選擇。'), '這不是意外，這是選擇。')
})

test('byte-split network output repairs the live boundary without rewriting reasons', async t => {
  for (const [english, chinese, expected] of [[run1Source, run1, run1Expected], [run2Source, run2, run2]]) {
    const bytes = new TextEncoder().encode(chinese)
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    } })))
    const updates = []
    assert.equal(await networkTranslation(english, new AbortController().signal, text => updates.push(text)), expected)
    assert.ok(updates.includes(expected))
    assert.ok(updates.every(text => !text.includes('契機')))
    t.mock.restoreAll()
  }
})

const liveRuns = [
  [source.replace('Section 8', 'affectionate'), '仔細記錄結果使實驗更容易重複。令人驚訝的結果不是失敗而是提出更好問題的理由。這是深情的結束。', '仔細記錄結果使實驗更容易重複。令人驚訝的結果不是失敗，而是提出更好問題的理由。這是深情的結束。'],
  [run2Source, '條件相同 仔細記錄結果使實驗更容易重複。令人驚訝的結果不是失敗。這是提出更好問題的理由。這是第 8 節的結尾。', '條件相同。仔細記錄結果使實驗更容易重複。令人驚訝的結果不是失敗。這是提出更好問題的理由。這是第 8 節的結尾。'],
  [run1Source, run1, run1Expected]
]

test('three live provider strings receive only source-backed contrast and recording punctuation', () => {
  for (const [english, chinese, expected] of liveRuns) {
    assert.equal(readableChinese(english, chinese), expected)
    assert.equal(readableChinese(english, chinese, false), expected)
    assert.equal(readableChinese(english, expected), expected)
    assert.equal(readableChinese(english, ''), '')
    assert.equal(expected.replace(/[\p{P}\s]/gu, ''), chinese.replace(/[\p{P}\s]/gu, ''))
  }
  assert.equal(readableChinese('This is not an accident but a deliberate choice', '這不是意外而是刻意的選擇。'), '這不是意外，而是刻意的選擇。')
  assert.equal(readableChinese('The conditions are the same. Recording the results carefully is helpful.', '條件相同 仔細記錄結果很有幫助。'), '條件相同。仔細記錄結果很有幫助。')
  for (const english of ['This is not a failure because it is incomplete', 'This is not a failure and it is incomplete', 'An unrelated short source']) {
    assert.equal(readableChinese(english, '這不是失敗而是提出更好問題的理由。'), '這不是失敗而是提出更好問題的理由。')
  }
  for (const english of ['We keep the conditions the same and record the results carefully', 'We keep the conditions the same by recording results carefully', 'Recording results carefully is helpful']) {
    assert.equal(readableChinese(english, '條件相同 仔細記錄結果很有幫助。'), '條件相同 仔細記錄結果很有幫助。')
  }
  assert.equal(readableChinese(run1Source, '相同的條件讓我們仔細記錄結果。'), '相同的條件讓我們仔細記錄結果。')
})

test('byte-split live outputs preserve words across the added punctuation boundaries', async t => {
  for (const [english, chinese, expected] of liveRuns) {
    const bytes = new TextEncoder().encode(chinese)
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    } })))
    assert.equal(await networkTranslation(english, new AbortController().signal, () => {}), expected)
    t.mock.restoreAll()
  }
})
