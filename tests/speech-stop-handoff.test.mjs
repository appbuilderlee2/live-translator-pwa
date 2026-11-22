import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { reviseRecognizedSegment } from '../src/transcript.mjs'

const drain = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

function harness(t, retry = false) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const captions = new Map(); const transitions = []; const requests = []
  let settling = false; let pending = 0; let id = 0
  const record = () => transitions.push({ settling, pending, visible: settling || pending > 0 })
  const queue = createTranslationQueue({ find: id => captions.get(id), online: () => true, changed: value => { pending = value.pending; record() }, execute: async segment => {
    requests.push(segment.en)
    if (retry && requests.length === 1) throw Object.assign(new Error('unavailable'), { code: 'upstream_unavailable', retryable: true })
    captions.set(segment.id, { ...segment, status: 'done', zh: '完成' })
  } })
  const messages = []; const states = []
  const rec = { starts: 0, start() { this.starts++; this.onstart() }, stop() {} }
  const speech = createSpeechController(rec, {
    commit(en, metadata) { const key = String(++id); captions.set(key, { id: key, en, timestamp: id, status: 'pending', ...metadata }); queue.enqueue(key); return key },
    revise(id, en, metadata) { captions.set(id, reviseRecognizedSegment(captions.get(id), en, metadata)); queue.enqueue(id) },
    settling(value) { settling = value; record() }, preview() {}, state(value) { states.push(value) }, message(value) { messages.push(value) }
  })
  t.after(() => { speech.dispose(); queue.dispose() })
  const emit = text => rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: .9 }], { isFinal: false })] })
  const advance = async ms => { for (let left = ms; left > 0; left -= 50) { t.mock.timers.tick(Math.min(50, left)); await drain() } }
  return { speech, rec, emit, advance, captions, transitions, requests, messages, states }
}

for (const ending of ['Stop', 'native-end', 'permission-error']) test(`pending notice spans terminal recognition handoff: ${ending}`, async t => {
  const h = harness(t, true)
  h.speech.start(); h.emit('Please preserve this unfinished lecture')
  assert.equal(h.requests.length, 0)
  const start = h.transitions.length
  if (ending === 'permission-error') h.rec.onerror({ error: 'not-allowed' })
  else h.speech.stop()
  if (ending === 'native-end') h.rec.onend()
  assert.equal(h.transitions.at(-1).visible, true)
  await h.advance(249)
  assert.equal(h.requests.length, 0)
  assert.ok(h.transitions.slice(start).every(s => s.visible))
  await h.advance(1000)
  assert.equal(h.requests.length, 1)
  assert.ok(h.transitions.slice(start).every(s => s.visible))
  assert.ok(h.transitions.slice(start).some(s => !s.settling && s.pending === 1))
  await h.advance(10000)
  assert.equal(h.requests.length, 2)
  assert.ok(h.transitions.slice(start, -1).every(s => s.visible))
  assert.equal(h.transitions.at(-1).visible, false)
  assert.equal(h.captions.size, 1)
})

test('empty and filler-only Stops never reserve phantom pending work', async t => {
  const h = harness(t)
  for (const text of ['', 'the', 'um']) {
    h.speech.start()
    if (text) h.emit(text)
    h.speech.stop(); h.rec.onend(); await h.advance(5000)
  }
  assert.equal(h.requests.length, 0)
  assert.ok(h.transitions.every(s => !s.visible))
})

for (const timing of ['before-stop', 'after-stop', 'after-end']) test(`speech retry copy clears while provider retries survive: ${timing}`, async t => {
  const h = harness(t, true)
  h.speech.start(); h.emit('Please preserve this unfinished lecture')
  if (timing === 'before-stop') {
    h.rec.onerror({ error: 'network' })
    assert.match(h.messages.at(-1), /Retrying/)
    assert.equal(h.states.at(-1), 'retrying')
  }
  h.speech.stop()
  if (timing === 'after-stop') h.rec.onerror({ error: 'network' })
  h.rec.onend()
  if (timing === 'after-end') h.rec.onerror({ error: 'network' })
  assert.equal(h.messages.at(-1), '')
  assert.equal(h.states.at(-1), 'idle')
  await h.advance(1000)
  assert.equal(h.requests.length, 1)
  assert.equal(h.transitions.at(-1).visible, true)
  await h.advance(10000)
  assert.equal(h.requests.length, 2)
  assert.equal(h.transitions.at(-1).visible, false)
  assert.equal(h.messages.at(-1), '')
  assert.equal(h.states.at(-1), 'idle')
  assert.equal(h.rec.starts, 1)
})

test('Stop preserves actionable permission failures instead of clearing every microphone message', async t => {
  const h = harness(t)
  h.speech.start(); h.rec.onerror({ error: 'network' }); h.rec.onerror({ error: 'not-allowed' }); h.rec.onend()
  assert.match(h.messages.at(-1), /Microphone not-allowed/)
  h.speech.stop(); await h.advance(10000)
  assert.match(h.messages.at(-1), /Microphone not-allowed/)
  assert.equal(h.requests.length, 0)
})
