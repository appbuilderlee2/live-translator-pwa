import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { recoverSegment, reviseRecognizedSegment, sameRecognizedSource } from '../src/transcript.mjs'
import { formatTranscript } from '../src/export.mjs'

const drain = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }

for (const ending of ['stop', 'permission-error']) test(`held speech drains once after ${ending}, including prior restarts, and survives reopening`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const captions = new Map(); const calls = []; let pending; let id = 0
  const queue = createTranslationQueue({ find: id => captions.get(id), online: () => true, changed: state => { pending = state.pending }, execute: async segment => {
    calls.push(segment.id)
    captions.set(segment.id, { ...segment, zh: '翻譯完成。', status: 'done', translation: { source: segment.en, text: '翻譯完成。' } })
  } })
  const rec = { start() {}, stop() { this.onend() } }
  const controller = createSpeechController(rec, {
    commit(en, metadata) { const key = ++id; captions.set(key, { id: key, en, timestamp: id, zh: '', status: 'pending', ...metadata }); queue.enqueue(key); return key },
    revise(id, en, metadata) { captions.set(id, reviseRecognizedSegment(captions.get(id), en, metadata)); queue.enqueue(id) },
    preview() {}, state() {}, message() {}
  })
  t.after(() => { controller.dispose(); queue.dispose() })
  const emit = (text, final = false) => rec.onresult({ results: [Object.assign([{ transcript: text, confidence: .8 }], { isFinal: final })] })
  const advance = async ms => { t.mock.timers.tick(ms); await drain() }
  controller.start()
  for (const text of ['My blood pressure was', 'The next lecture begins with', 'Please ask the pharmacist about']) {
    emit(text); await advance(1500); rec.onend(); await advance(10000)
    assert.equal(calls.length, 0)
  }
  if (ending === 'stop') controller.stop()
  else { rec.onerror({ error: 'not-allowed' }); rec.onend() }
  for (let i = 0; i < 10; i++) await advance(6000)
  assert.equal(captions.size, 3); assert.equal(calls.length, 3); assert.equal(new Set(calls).size, 3)
  assert.equal(pending, 0)
  for (const segment of captions.values()) {
    assert.equal(segment.status, 'done'); assert.equal(segment.unconfirmed, true)
    assert.equal(segment.provisional, false); assert.equal(segment.forced, false)
    assert.match(formatTranscript([segment]), /辨識未確認 \/ Unconfirmed recognition/)
    assert.doesNotMatch(formatTranscript([segment]), /pending/i)
  }
  const restored = JSON.parse(JSON.stringify([...captions.values()])).map(recoverSegment)
  for (const segment of restored) { captions.set(segment.id, segment); queue.enqueue(segment.id) }
  await advance(60000)
  assert.equal(calls.length, 3); assert.equal(pending, 0)
  emit('Please ask the pharmacist about.', true)
  for (let i = 0; i < 5; i++) await advance(6000)
  assert.equal(captions.get(3).unconfirmed, false)
  assert.equal(captions.get(3).status, 'done'); assert.equal(calls.length, 3)
  assert.doesNotMatch(formatTranscript([captions.get(3)]), /Unconfirmed|pending/i)
  console.log(`${ending}: 3 held lines; 3 requests; 0 pending; reload 0 extra; late final 0 extra`)
})

test('a late native final with punctuation retains an in-flight unconfirmed translation', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  let segment; let resolve; let calls = 0
  const queue = createTranslationQueue({ find: () => segment, online: () => true, execute: async source => {
    calls++; segment = { ...segment, status: 'translating' }
    await new Promise(done => { resolve = done })
    assert.ok(sameRecognizedSource(source.en, segment.en))
    segment = { ...segment, status: 'done', zh: '請詢問藥師。', translation: { source: source.en, text: '請詢問藥師。' } }
  } })
  const rec = { start() {}, stop() {} }
  const controller = createSpeechController(rec, {
    commit(en, metadata) { segment = { id: 1, en, timestamp: 0, status: 'pending', ...metadata }; queue.enqueue(1); return 1 },
    revise(id, en, metadata) { segment = reviseRecognizedSegment(segment, en, metadata); queue.enqueue(id) },
    preview() {}, state() {}, message() {}
  })
  t.after(() => { controller.dispose(); queue.dispose() })
  const emit = (text, final) => rec.onresult({ results: [Object.assign([{ transcript: text }], { isFinal: final })] })
  controller.start(); emit('Please ask the pharmacist', false); controller.stop(); rec.onend()
  t.mock.timers.tick(250); t.mock.timers.tick(0); await drain()
  assert.equal(calls, 1); assert.equal(segment.unconfirmed, true)
  emit('Please ask the pharmacist.', true)
  assert.equal(segment.status, 'translating'); assert.equal(segment.unconfirmed, false)
  resolve(); await drain(); t.mock.timers.tick(10000); await drain()
  assert.equal(calls, 1); assert.equal(segment.status, 'done')
})

test('empty and failed unconfirmed translations retain truthful export state', () => {
  assert.equal(formatTranscript([]), '')
  const segment = recoverSegment({ en: 'Please ask the pharmacist', zh: '', timestamp: 0, status: 'error', unconfirmed: true, provisional: false, forced: false, settled: true })
  assert.match(formatTranscript([segment]), /Unconfirmed recognition/)
  assert.match(formatTranscript([segment]), /Translation still pending/)
})
