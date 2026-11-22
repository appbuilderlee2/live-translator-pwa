import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { reviseRecognizedSegment, recoverSegment } from '../src/transcript.mjs'
import { formatTranscript } from '../src/export.mjs'

const source = 'Section 8 today we are discussing scientific experiment a scientific experiment begins with a clear question we change one factor and keep the other conditions the same recording result carefully makes the experiment easier to repeat a surprising result is not a failure it is a reason to ask a better question this is the end of Section 8'
const prefix = source.split(' ').slice(0, 33).join(' ')
const expected = source.split(' a surprising result ')
expected[1] = 'a surprising result ' + expected[1]
const drain = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

function harness(t, connected = true) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const captions = new Map(); const calls = []; const dispatched = new Set()
  let id = 0; let pending = 0
  const queue = createTranslationQueue({ find: id => captions.get(id), online: () => connected, changed: s => { pending = s.pending }, execute: async s => {
    dispatched.add(s.id); calls.push({ id: s.id, en: s.en })
    captions.set(s.id, { ...s, status: 'done', zh: '完成。', translation: { source: s.en, text: '完成。' } })
  } })
  const rec = { start() { this.onstart() }, stop() {} }
  const speech = createSpeechController(rec, {
    commit(en, metadata) { const key = ++id; captions.set(key, { id: key, en, timestamp: key, status: 'pending', ...metadata }); queue.enqueue(key); return key },
    revise(id, en, metadata) { if (!en) captions.delete(id); else captions.set(id, reviseRecognizedSegment(captions.get(id), en, metadata)); queue.enqueue(id) },
    canRevise: id => !dispatched.has(id) && captions.get(id)?.status === 'pending',
    isDispatched: id => dispatched.has(id),
    preview() {}, state() {}, message() {}
  })
  const emit = (text, final = false) => rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: .96 }], { isFinal: final })] })
  const advance = async ms => { for (let left = ms; left > 0; left -= 10) { t.mock.timers.tick(Math.min(10, left)); await drain() } }
  t.after(() => { speech.dispose(); queue.dispose() })
  return { captions, calls, speech, rec, emit, advance, queue, pending: () => pending, connect() { connected = true; queue.wake() } }
}

for (const interims of [false, true]) test(`reported section-8 final preserves the complete experiment clause; prior interims=${interims}`, async t => {
  const h = harness(t); h.speech.start()
  if (interims) {
    h.emit(prefix); await h.advance(1250)
    h.emit(source); await h.advance(1250)
    assert.equal(h.calls.length, 0)
  }
  h.emit(source, true)
  assert.equal(h.calls.length, 0)
  assert.deepEqual([...h.captions.values()].map(s => s.en), expected)
  await h.advance(20000)
  assert.deepEqual(h.calls.map(s => s.en), expected)
  assert.equal(new Set(h.calls.map(s => s.id)).size, h.calls.length)
  assert.equal(h.calls.map(s => s.en).join(' '), source)
  assert.equal(h.pending(), 0)
  const before = h.calls.length
  for (const s of [...h.captions.values()].map(recoverSegment)) { h.captions.set(s.id, s); h.queue.enqueue(s.id) }
  await h.advance(10000)
  assert.equal(h.calls.length, before)
})

test('offline Stop captions are re-cut before their first dispatch when the full final arrives', async t => {
  const h = harness(t, false); h.speech.start()
  h.emit(prefix); await h.advance(1250); h.emit(source); await h.advance(1250)
  h.speech.stop(); await h.advance(4000)
  assert.equal(h.calls.length, 0)
  h.emit(source, true); h.rec.onend(); h.connect(); await h.advance(20000)
  assert.deepEqual(h.calls.map(s => s.en), expected)
  assert.equal(h.pending(), 0)
})

for (const stopped of [false, true]) test(`already dispatched prefix is never re-cut, changed or re-requested; stopped=${stopped}`, async t => {
  const h = harness(t); h.speech.start(); h.emit(prefix, true); await h.advance(4000)
  assert.deepEqual(h.calls.map(s => s.en), [prefix])
  const original = structuredClone(h.captions.get(1))
  if (stopped) h.speech.stop()
  h.emit(source, true); h.rec.onend(); await h.advance(20000)
  assert.deepEqual(h.captions.get(1), original)
  assert.equal(h.calls.filter(s => s.id === 1).length, 1)
  assert.equal(h.calls.map(s => s.en).join(' '), source)
  assert.equal(h.pending(), 0)
})

test('long clauses without a sound start stay intact rather than using the soft word cap', async t => {
  const h = harness(t); h.speech.start()
  const text = 'Carefully ' + Array(60).fill('reviewing').join(' ') + ' the complete recorded results'
  h.emit(text, true); await h.advance(10000)
  assert.deepEqual(h.calls.map(s => s.en), [text])
})

test('embedded clause starters do not become caption boundaries', async t => {
  const h = harness(t); h.speech.start()
  const text = Array(25).fill('Consider').join(' ') + ' whether we can confirm that a surprising result is useful before making any decisions about the entire carefully controlled experiment'
  h.emit(text, true); await h.advance(10000)
  assert.deepEqual(h.calls.map(s => s.en), [text])
})

test('explicit sentence ends remain separate and empty/error completion manufactures no source', async t => {
  const h = harness(t); h.speech.start()
  h.emit('The experiment is complete. We can discuss the result.', true); await h.advance(10000)
  assert.deepEqual(h.calls.map(s => s.en), ['The experiment is complete.', 'We can discuss the result.'])
  h.speech.stop(); h.rec.onerror({ error: 'network' }); h.rec.onend(); await h.advance(10000)
  assert.equal(h.calls.length, 2)
  assert.equal(h.pending(), 0)
})

test('previously sent fragment translations are not rewritten by a display-only guess', () => {
  const captions = [
    { en: prefix, zh: '仔細記錄結果進行實驗。', timestamp: 0, status: 'done' },
    { en: source.slice(prefix.length).trim(), zh: '更容易重複。', timestamp: 1, status: 'done' }
  ]
  const original = structuredClone(captions)
  assert.match(formatTranscript(captions), /進行實驗。/)
  assert.deepEqual(captions, original)
})
