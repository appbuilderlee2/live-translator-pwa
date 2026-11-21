import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { recoverSegment, reviseRecognizedSegment } from '../src/transcript.mjs'

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

for (const ending of ['ended', 'immediate', 'delayed-end', 'permission-error', 'empty']) test(`Stop then Start isolates terminal state: ${ending}`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const captions = new Map(); const calls = []; let id = 0; let pending; let state
  const queue = createTranslationQueue({ find: id => captions.get(id), online: () => true, changed: value => { pending = value.pending }, execute: async segment => {
    calls.push(segment.id)
    captions.set(segment.id, { ...segment, status: 'done', zh: '翻譯完成', translation: { source: segment.en, text: '翻譯完成' } })
  } })
  const rec = { starts: 0, start() { this.starts++ }, stop() {} }
  const speech = createSpeechController(rec, {
    commit(en, metadata) { const key = ++id; captions.set(key, { id: key, en, timestamp: id, status: 'pending', ...metadata }); queue.enqueue(key); return key },
    revise(id, en, metadata) { captions.set(id, reviseRecognizedSegment(captions.get(id), en, metadata)); queue.enqueue(id) },
    state(value) { state = value }, preview() {}, message() {}
  })
  t.after(() => { speech.dispose(); queue.dispose() })
  const emit = (text, final = false) => rec.onresult({ results: [Object.assign([{ transcript: text, confidence: .9 }], { isFinal: final })] })
  const advance = async ms => { for (let remaining = ms; remaining > 0; remaining -= 250) { t.mock.timers.tick(Math.min(250, remaining)); await flush() } }
  speech.start()
  if (ending !== 'empty') { emit('The first round has retained speech'); await advance(1500) }
  if (ending === 'permission-error') rec.onerror({ error: 'not-allowed' })
  else speech.stop()
  if (ending !== 'delayed-end') rec.onend()
  if (ending === 'ended') await advance(10000)
  speech.start()
  if (ending === 'delayed-end') {
    assert.equal(rec.starts, 1)
    rec.onaudiostart(); assert.equal(state, 'requesting')
    rec.onend()
  }
  assert.equal(rec.starts, 2)
  const source = 'The second round begins with a complete question'
  emit(source); await advance(15000)
  assert.equal(calls.length, ending === 'empty' ? 0 : 1)
  const second = [...captions.values()].find(s => s.en === source)
  assert.ok(second); assert.equal(second.provisional, true); assert.equal(second.unconfirmed, false)
  emit(source, true); await advance(15000)
  assert.equal(calls.filter(id => id === second.id).length, 1)
  const held = 'The second round also has retained speech'
  rec.onresult({ results: [Object.assign([{ transcript: source, confidence: .9 }], { isFinal: true }), Object.assign([{ transcript: held, confidence: .9 }], { isFinal: false })] })
  await advance(1500); rec.onerror({ error: 'network' }); rec.onend(); await advance(10000)
  assert.equal(calls.length, ending === 'empty' ? 1 : 2)
  speech.stop(); rec.onend(); await advance(20000)
  assert.equal(calls.length, ending === 'empty' ? 2 : 3)
  assert.equal(new Set(calls).size, calls.length); assert.equal(pending, 0)
  const saved = [...captions.values()].find(s => s.en === held)
  assert.equal(saved.unconfirmed, true)
  rec.onresult({ results: [Object.assign([{ transcript: source, confidence: .9 }], { isFinal: true }), Object.assign([{ transcript: held, confidence: .9 }], { isFinal: true })] }); await advance(15000)
  assert.equal(calls.filter(id => id === saved.id).length, 1)
  for (const segment of JSON.parse(JSON.stringify([...captions.values()])).map(recoverSegment)) { captions.set(segment.id, segment); queue.enqueue(segment.id) }
  await advance(10000); assert.equal(new Set(calls).size, calls.length); assert.equal(pending, 0)
  console.log(`${ending}: second Start interim 0 requests; native final once; Stop held once; late final/reload 0 extra; 0 pending`)
})
