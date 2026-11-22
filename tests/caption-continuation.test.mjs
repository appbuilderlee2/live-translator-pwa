import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayTranscript, recoverSegment } from '../src/transcript.mjs'
import { formatTranscript } from '../src/export.mjs'
import { readableChinese } from '../shared/phrasing.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { createSpeechController } from '../src/speech.mjs'

const english = 'Section 8 today we are discussing scientific experiment a scientific experiment begins with a clear question we change one factor and keep the other conditions the same recording results carefully makes the experiment'
const continuation = 'easier to repeat a surprising result is not a failure it is a reason to ask a better question this is the end of Section 8'
const chinese = '第8節。今天我們討論科學實驗。科學實驗從一個明確的問題開始。我們改變一個因素並保持其他條件相同。仔細記錄結果使實驗。'
const remaining = '更容易重複。令人驚訝的結果並不是失敗，而是提出更好問題的理由。這是第 8 節的結尾。'

function pair() {
  return [[english, chinese, [0, 33]], [continuation, remaining, [33, 59]]].map(([en, zh, range], index) => ({
    id: String(index), en, zh, timestamp: index, status: 'done', spoken: true, settled: true,
    translation: { source: en, text: zh },
    recognitionEvidence: { session: 5, range, finalRanges: [{ end: 59 }] }
  }))
}

test('formatter can append a period to the captured incomplete source, irrespective of provider punctuation', () => {
  const without = chinese.slice(0, -1)
  assert.equal(readableChinese(english, without, false), without)
  assert.equal(readableChinese(english, without), chinese)
  assert.equal(readableChinese(english, chinese), chinese)
})

test('captured same-result split changes presentation only, consistently for live, saved, copied and downloaded text', () => {
  const segments = pair(); const original = structuredClone(segments)
  for (const segment of segments) Object.freeze(segment)
  Object.freeze(segments)
  const current = displayTranscript(segments)
  const history = displayTranscript(JSON.parse(JSON.stringify(segments)).map(recoverSegment))
  assert.equal(current[0].zh, chinese.slice(0, -1))
  assert.equal(current[1].zh, remaining)
  assert.deepEqual(history, current)
  assert.deepEqual(current.map(s => s.en), original.map(s => s.en))
  assert.deepEqual(segments, original)
  assert.equal(formatTranscript(segments), formatTranscript(current))
  assert.match(formatTranscript(segments), /使實驗\n\n/)
  assert.doesNotMatch(formatTranscript(segments), /使實驗。/)
  assert.deepEqual(displayTranscript(current), current)
})

test('causative continuation rule handles other objects and comparative complements', () => {
  for (const [verb, object, comparative, zh, next] of [
    ['made', 'process', 'safer to use', '這使流程。', '更安全。'],
    ['making', 'tools', 'simpler to maintain', '讓工具。', '比較容易維護。'],
    ['makes', 'system', 'more reliable to operate', '這讓系統。', '更可靠。']
  ]) {
    const segments = pair()
    Object.assign(segments[0], { en: `This ${verb} the ${object}`, zh })
    Object.assign(segments[1], { en: comparative, zh: next })
    assert.equal(displayTranscript(segments)[0].zh, zh.slice(0, -1))
  }
})

test('ordinary sentence ends, uncertain grammar and nonmatching Chinese remain unchanged', () => {
  for (const patch of [
    { en: english + '.' }, { en: english + '?' }, { en: english + '!' }, { en: english + ';' },
    { en: 'We completed the experiment' }, { en: 'This makes the experiment easier' },
    { en: 'This makes the process simple' }, { en: 'It makes sense' },
    { zh: '我們完成了實驗。' }, { zh: chinese + '。' }, { zh: chinese.slice(0, -1) + '！' }
  ]) {
    const segments = pair(); Object.assign(segments[0], patch)
    assert.strictEqual(displayTranscript(segments), segments)
  }
  for (const patch of [{ en: 'A surprising result is useful' }, { en: 'Easier tasks are useful' }, { en: 'Easier to' }, { zh: '實驗比較容易重複。' }]) {
    const segments = pair(); Object.assign(segments[1], patch)
    assert.strictEqual(displayTranscript(segments), segments)
  }
})

test('missing, foreign, noncontiguous or separate-native-final evidence never connects captions', () => {
  for (const patch of [undefined, {}, { session: 5, range: [33, 59], finalRanges: {} },
    { session: 5, range: [33, 59], finalRanges: [null] },
    { session: 6, range: [33, 59], finalRanges: [{ end: 59 }] },
    { session: 5, range: [34, 59], finalRanges: [{ end: 59 }] },
    { session: 5, range: [0, 26], finalRanges: [{ end: 59 }] },
    { session: 5, range: [33, 59], finalRanges: [{ end: 60 }] },
    { session: 5, range: [33, 59], finalRanges: [{ end: 59, saved: true }] }
  ]) {
    const segments = pair(); segments[1].recognitionEvidence = patch
    assert.strictEqual(displayTranscript(segments), segments)
  }
  const segments = pair(); segments[0].recognitionEvidence.finalRanges = [{ end: 33 }]
  assert.strictEqual(displayTranscript(segments), segments)
  for (const segment of segments) segment.recognitionEvidence.finalRanges = [{ end: 33 }, { end: 59 }]
  assert.strictEqual(displayTranscript(segments), segments)
})

test('pending, partial, unconfirmed-without-final and empty captions do not trigger continuation', () => {
  assert.deepEqual(displayTranscript([]), [])
  const single = pair().slice(0, 1)
  assert.strictEqual(displayTranscript(single), single)
  for (const index of [0, 1]) for (const patch of [{ status: 'pending' }, { status: 'translating' }, { status: 'error' }, { settled: false }, { provisional: true }, { forced: true }, { zh: '' }]) {
    const segments = pair(); Object.assign(segments[index], patch)
    assert.strictEqual(displayTranscript(segments), segments)
  }
  const segments = pair()
  for (const segment of segments) { segment.unconfirmed = true; segment.recognitionEvidence.finalRanges = [] }
  assert.strictEqual(displayTranscript(segments), segments)
})

test('display, history recovery and export do not enqueue or resend completed captions', async t => {
  let calls = 0
  const segments = pair()
  const queue = createTranslationQueue({ find: id => segments.find(s => s.id === id), online: () => true, execute: async () => { calls++ }, changed() {} })
  t.after(() => queue.dispose())
  for (const snapshot of [segments, segments.map(recoverSegment), JSON.parse(JSON.stringify(segments)).map(recoverSegment)]) {
    displayTranscript(snapshot); formatTranscript(snapshot)
    for (const segment of snapshot) queue.enqueue(segment.id)
  }
  for (let index = 0; index < 20; index++) await Promise.resolve()
  assert.equal(calls, 0)
  assert.equal(segments[0].en, english)
  assert.equal(segments[0].zh, chinese)
})

test('native boundary metadata supports the display rule with diagnostics disabled', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  assert.equal(typeof window, 'undefined')
  const segments = []
  const rec = { start() { this.onstart() }, stop() {} }
  const speech = createSpeechController(rec, {
    commit(en, metadata) {
      const id = segments.length
      segments.push({ id, en, zh: id === 0 ? '使實驗。' : '更容易重複。', timestamp: id, status: 'done', ...metadata })
      return id
    },
    revise(id, en, metadata) { Object.assign(segments[id], { en, ...metadata }) },
    state() {}, preview() {}, message() {}
  })
  t.after(() => speech.dispose())
  const text = `${Array(27).fill('word').join(' ')} makes the experiment easier to repeat and we will discuss these useful results at the next meeting`
  speech.start()
  rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: .95 }], { isFinal: true })] })
  await speech.finish(); t.mock.timers.tick(10000)
  assert.equal(segments.length, 2)
  assert.ok(segments.every(s => !s.recognitionEvidence && s.recognitionBoundary))
  assert.equal(displayTranscript(segments)[0].zh, '使實驗')
  assert.equal(segments[0].zh, '使實驗。')
  assert.equal(displayTranscript(JSON.parse(JSON.stringify(segments)).map(recoverSegment))[0].zh, '使實驗')
})
