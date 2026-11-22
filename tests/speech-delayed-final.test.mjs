import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { recoverSegment, reviseRecognizedSegment } from '../src/transcript.mjs'

const opening = 'Section 8 today we are discussing scientific experiments a scientific experiment begins with a clear question we change one factor and keep'
const earlier = `${opening} the other conditions the same recording result carefully makes the experiment easier`
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

function harness(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const captions = new Map(); const calls = []; let id = 0; let pending
  const queue = createTranslationQueue({ find: id => captions.get(id), online: () => true, changed: value => { pending = value.pending }, execute: async segment => {
    calls.push({ id: segment.id, en: segment.en })
    captions.set(segment.id, { ...segment, zh: '翻譯完成。', status: 'done', translation: { source: segment.en, text: '翻譯完成。' } })
  } })
  const rec = { starts: 0, start() { this.starts++; this.onstart() }, stop() {} }
  const speech = createSpeechController(rec, {
    commit(en, metadata) { const key = ++id; captions.set(key, { id: key, en, timestamp: id, status: 'pending', ...metadata }); queue.enqueue(key); return key },
    revise(id, en, metadata) { assert.ok(captions.has(id)); captions.set(id, reviseRecognizedSegment(captions.get(id), en, metadata)); queue.enqueue(id) },
    state() {}, preview() {}, message() {}
  })
  t.after(() => { speech.dispose(); queue.dispose() })
  const emit = (text, final = false) => rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: .97 }], { isFinal: final })] })
  const advance = async ms => { for (let left = ms; left > 0; left -= 250) { t.mock.timers.tick(Math.min(250, left)); await flush() } }
  return { captions, calls, queue, rec, speech, emit, advance, pending: () => pending }
}

for (const boundary of ['before-end', 'after-end', 'Start-before-delayed-end']) test(`reconstructed delayed section-8 final stays with its native owner: ${boundary}`, async t => {
  const h = harness(t)
  h.speech.start(); h.emit(earlier); await h.advance(1500)
  assert.equal(h.calls.length, 0)
  h.speech.stop(); h.rec.onend(); await h.advance(10000)
  assert.equal(h.calls.length, 1)
  const original = structuredClone(h.captions.get(1))
  h.speech.start(); h.emit(opening); await h.advance(1500)
  assert.equal(h.calls.length, 1)
  h.speech.stop()
  if (boundary === 'after-end') h.rec.onend()
  if (boundary === 'Start-before-delayed-end') { h.speech.start(); assert.equal(h.rec.starts, 2) }
  await h.advance(4060)
  h.emit(`${opening} the`, true)
  await h.advance(15000)
  assert.deepEqual(h.captions.get(1), original)
  assert.deepEqual(h.calls.map(call => call.id), [1, 2])
  assert.equal(h.captions.get(2).en, opening)
  assert.equal(h.captions.get(2).unconfirmed, false)
  assert.equal(h.captions.size, 2)
  assert.equal(h.pending(), 0)
  if (boundary === 'Start-before-delayed-end') {
    h.rec.onend(); assert.equal(h.rec.starts, 3)
    h.emit('A distinct new round remains live'); await h.advance(10000)
    assert.equal(h.calls.length, 2)
    h.speech.stop(); h.rec.onend(); await h.advance(15000)
    assert.equal(h.calls.length, 3)
  }
  const count = h.calls.length
  for (const segment of JSON.parse(JSON.stringify([...h.captions.values()])).map(recoverSegment)) { h.captions.set(segment.id, segment); h.queue.enqueue(segment.id) }
  await h.advance(15000)
  assert.equal(h.calls.length, count); assert.equal(h.pending(), 0)
})

test('a fresh native start with a repeated opening cannot revise an older stopped caption', async t => {
  const h = harness(t)
  h.speech.start(); h.emit(earlier); await h.advance(1500)
  h.speech.stop(); h.rec.onend(); await h.advance(10000)
  h.speech.start(); h.emit(`${opening} the`, true); await h.advance(1500)
  h.speech.stop(); h.rec.onend(); await h.advance(15000)
  assert.equal(h.captions.get(1).en, earlier)
  assert.equal(h.captions.get(2).en, `${opening} the`)
  assert.deepEqual(h.calls.map(call => call.id), [1, 2])
})

test('a delayed final at a nonzero result index preserves cumulative rows and settled prefixes', async t => {
  const h = harness(t)
  h.speech.start(); h.emit(earlier); await h.advance(1500)
  h.speech.stop(); h.rec.onend(); await h.advance(10000)
  h.speech.start()
  const head = opening.split(' ').slice(0, 8).join(' ')
  const tail = opening.split(' ').slice(8).join(' ')
  const emit = (text, final) => h.rec.onresult({ resultIndex: 1, results: [
    Object.assign([{ transcript: head, confidence: .97 }], { isFinal: true }),
    Object.assign([{ transcript: text, confidence: .97 }], { isFinal: final })
  ] })
  emit(tail, false); await h.advance(1500)
  h.speech.stop(); h.speech.start(); await h.advance(4060)
  emit(`${tail} the`, true); h.rec.onend(); await h.advance(20000)
  assert.deepEqual([...h.captions.values()].map(s => s.en), [earlier, head, tail])
  assert.deepEqual(h.calls.map(call => call.id), [1, 2, 3])
  assert.equal(h.pending(), 0)
})

test('final articles and filler suffixes never create translated captions; later meaningful extensions survive', async t => {
  const h = harness(t)
  h.speech.start()
  h.emit('the', true); await h.advance(10000)
  assert.equal(h.captions.size, 0); assert.equal(h.calls.length, 0)
  h.emit('Please wait here. the', true); await h.advance(1500)
  h.speech.stop(); await h.advance(10000)
  assert.deepEqual([...h.captions.values()].map(s => s.en), ['Please wait here.'])
  assert.equal(h.calls.length, 1)
  h.emit('Please wait here. the station is open.', true); await h.advance(15000)
  assert.deepEqual([...h.captions.values()].map(s => s.en), ['Please wait here.', 'the station is open.'])
  assert.deepEqual(h.calls.map(call => call.en), ['Please wait here.', 'the station is open.'])
  assert.equal(h.pending(), 0)
})
