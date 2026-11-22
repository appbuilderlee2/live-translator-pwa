import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { reviseRecognizedSegment, recoverSegment } from '../src/transcript.mjs'

const drain = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }
const prefix = 'Chapter 3 today we are discussing garden planning a garden project begins with a simple drawing we choose one plant'

function harness(t, online = true, failFirst = false) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const captions = new Map(); const calls = []; const dispatched = new Set()
  let id = 0; let pending = 0; let connected = online
  const queue = createTranslationQueue({ find: id => captions.get(id), online: () => connected, changed: s => { pending = s.pending }, execute: async s => {
    dispatched.add(s.id); calls.push({ id: s.id, en: s.en })
    if (failFirst && calls.length === 1) throw Object.assign(new Error('unavailable'), { code: 'upstream_unavailable', retryable: true })
    captions.set(s.id, { ...s, status: 'done', zh: '翻譯完成', translation: { source: s.en, text: '翻譯完成' } })
  } })
  const rec = { starts: 0, start() { this.starts++; this.onstart() }, stop() {} }
  const speech = createSpeechController(rec, {
    commit(en, metadata) { const key = ++id; captions.set(key, { id: key, en, timestamp: id, status: 'pending', ...metadata }); queue.enqueue(key); return key },
    revise(id, en, metadata) { if (!en) captions.delete(id); else captions.set(id, reviseRecognizedSegment(captions.get(id), en, metadata)); queue.enqueue(id) },
    canRevise: id => !dispatched.has(id) && captions.get(id)?.status === 'pending',
    state() {}, preview() {}, message() {}
  })
  t.after(() => { speech.dispose(); queue.dispose() })
  const emit = (texts, finals = false) => rec.onresult({ resultIndex: 0, results: (Array.isArray(texts) ? texts : [texts]).map((text, index) => Object.assign([{ transcript: text, confidence: .97 }], { isFinal: Array.isArray(finals) ? finals[index] : finals })) })
  const advance = async ms => { for (let left = ms; left > 0; left -= 10) { t.mock.timers.tick(Math.min(10, left)); await drain() } }
  return { captions, calls, rec, speech, emit, advance, queue, pending: () => pending, connect() { connected = true; queue.wake() } }
}

for (const suffix of ['keep', 'the', 'and']) test(`frozen Stop debounce absorbs same-session final suffix '${suffix}' before dispatch`, async t => {
  const h = harness(t)
  h.speech.start(); h.emit(prefix); await h.advance(1250)
  h.speech.stop()
  t.mock.timers.setTime(Date.now() + 4000)
  h.rec.onaudioend()
  await h.advance(6)
  assert.equal(h.calls.length, 0)
  h.emit([prefix, suffix], [false, false])
  h.emit(`${prefix} ${suffix}`, true); h.rec.onend()
  await h.advance(249)
  assert.equal(h.calls.length, 0)
  await h.advance(10000)
  assert.deepEqual(h.calls.map(s => s.en), [`${prefix} ${suffix}`])
  assert.equal(h.captions.size, 1); assert.equal(h.pending(), 0)
})

for (const suffix of ['keep', 'and', 'the']) test(`already queued, never-dispatched caption absorbs '${suffix}' from a late final`, async t => {
  const h = harness(t, false)
  h.speech.start(); h.emit(prefix); await h.advance(1250)
  h.speech.stop(); await h.advance(4000)
  assert.equal(h.captions.size, 1); assert.equal(h.calls.length, 0)
  h.emit(`${prefix} ${suffix}`, true); h.rec.onend()
  h.connect(); await h.advance(10000)
  assert.deepEqual(h.calls.map(s => s.en), [`${prefix} ${suffix}`])
  assert.equal(h.captions.size, 1); assert.equal(h.pending(), 0)
})

test('separate native-final function-word rows stay attached before dispatch', async t => {
  const h = harness(t)
  h.speech.start(); h.emit(prefix); await h.advance(1250)
  h.speech.stop(); h.emit([prefix, 'and'], true); h.rec.onend()
  await h.advance(10000)
  assert.deepEqual(h.calls.map(s => s.en), [`${prefix} and`])
  assert.equal(h.pending(), 0)
})

for (const suffix of ['the', 'and', 'keep']) test(`after translation, late '${suffix}' never changes or re-requests the translated source`, async t => {
  const h = harness(t)
  h.speech.start(); h.emit(prefix); await h.advance(1250)
  h.speech.stop(); await h.advance(4000)
  assert.equal(h.calls.length, 1)
  const original = structuredClone(h.captions.get(1))
  h.emit(`${prefix} ${suffix}`, true); h.rec.onend(); await h.advance(20000)
  const current = h.captions.get(1)
  for (const key of ['en', 'zh', 'translation', 'status']) assert.deepEqual(current[key], original[key])
  assert.equal(h.calls.filter(s => s.id === 1).length, 1)
  assert.deepEqual(h.calls.map(s => s.en), suffix === 'keep' ? [prefix, suffix] : [prefix])
  assert.equal(h.pending(), 0)
  const count = h.calls.length
  for (const s of [...h.captions.values()].map(recoverSegment)) { h.captions.set(s.id, s); h.queue.enqueue(s.id) }
  await h.advance(10000); assert.equal(h.calls.length, count)
})

test('a fresh same-session suffix cannot attach across Stop and Start', async t => {
  const h = harness(t, false)
  h.speech.start(); h.emit(prefix); await h.advance(1250)
  h.speech.stop(); h.rec.onend(); await h.advance(1000)
  const previous = structuredClone(h.captions.get(1))
  h.speech.start(); h.emit('keep', true); h.speech.stop(); h.rec.onend()
  h.connect(); await h.advance(20000)
  assert.equal(h.captions.get(1).en, previous.en)
  assert.deepEqual(h.calls.map(s => s.en), [prefix, 'keep'])
})

test('empty late native results do not manufacture a suffix', async t => {
  const h = harness(t)
  h.speech.start(); h.speech.stop(); h.emit([], true); h.rec.onend()
  await h.advance(10000)
  assert.equal(h.captions.size, 0); assert.equal(h.calls.length, 0); assert.equal(h.pending(), 0)
})

test('a previously published editable fragment rejoins its same-session neighbour', async t => {
  const h = harness(t, false)
  h.speech.start(); h.emit(`${prefix}.`); await h.advance(1250)
  h.emit([`${prefix}.`, 'keep'], true); h.speech.stop(); await h.advance(1000)
  assert.equal(h.captions.size, 2)
  h.emit(`${prefix} keep`, true); h.rec.onend()
  h.connect(); await h.advance(15000)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].en, `${prefix} keep`)
  assert.equal(h.captions.size, 1)
})

test('a failed first dispatch remains immutable while its original source retries', async t => {
  const h = harness(t, true, true)
  h.speech.start(); h.emit(prefix); await h.advance(1250)
  h.speech.stop(); await h.advance(4000)
  assert.deepEqual(h.calls.map(s => s.en), [prefix])
  h.emit(`${prefix} and`, true); h.rec.onend(); await h.advance(12000)
  assert.deepEqual(h.calls.map(s => s.en), [prefix, prefix])
  assert.equal(h.captions.get(1).en, prefix)
  assert.equal(h.captions.size, 1); assert.equal(h.pending(), 0)
})
