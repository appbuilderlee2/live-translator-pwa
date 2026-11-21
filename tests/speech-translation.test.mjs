import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { localTranslation, translateWithFallback } from '../src/local.mjs'
import { networkTranslation } from '../src/network.mjs'
import { recoverSegment, translationReady } from '../src/transcript.mjs'
import { formatTranscript } from '../src/export.mjs'
import { translateHandler } from './handler-fixture.mjs'

const partial = 'my blood pressure was'
const full = 'my blood pressure was 140 over 90 this morning'
const zh = '今天早上我的血壓是140/90。'
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }

for (const provider of ['local', 'Google', 'OpenAI']) for (const kind of ['interim', 'final', 'split-final']) test(`${provider}: 71.5s ${kind} fragment has no translation; 73.3s completed reading settles at 75.3s`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const original = fetch; const key = process.env.OPENAI_API_KEY
  if (provider === 'OpenAI') process.env.OPENAI_API_KEY = 'test'; else delete process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  const calls = []; const captions = new Map(); let id = 0
  const local = provider === 'local' ? { translate: async source => { calls.push(source); return zh } } : null
  globalThis.fetch = async (url, options) => {
    if (url === '/api/translate') { calls.push(JSON.parse(options.body).text); return translateHandler(new Request('http://localhost/api/translate', options)) }
    return provider === 'Google' ? Response.json([[[zh]]]) : new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: zh } }] })}\n\ndata: [DONE]\n\n`)
  }
  const queue = createTranslationQueue({ find: key => captions.get(key), online: () => true, execute: async segment => {
    await translateWithFallback(local, segment.en, new AbortController().signal, text => { segment.zh = text }, [], { spoken: true })
    segment.status = 'done'
  } })
  const rec = { start() {}, stop() {} }
  const controller = createSpeechController(rec, {
    commit(en, metadata) { const key = ++id; captions.set(key, { id: key, en, zh: '', timestamp: Date.now(), status: 'pending', ...metadata }); queue.enqueue(key); return key },
    revise(key, en, metadata) { const segment = captions.get(key); Object.assign(segment, { en, ...metadata }); queue.enqueue(key) },
    preview() {}, state() {}, message() {}
  })
  t.after(() => { controller.dispose(); queue.dispose() })
  const emit = rows => rec.onresult({ results: rows.map(([text, final]) => Object.assign([{ transcript: text, confidence: .99 }], { isFinal: final })) })
  const advance = async ms => { t.mock.timers.tick(ms); await flush() }
  controller.start(); await advance(70300)
  if (kind === 'interim') emit([[partial, false]])
  await advance(1200)
  if (kind !== 'interim') emit([[partial, true]])
  await flush()
  assert.equal(Date.now(), 71500)
  assert.deepEqual(calls, []); assert.ok([...captions.values()].every(s => !s.zh && !translationReady(s)))
  await advance(1800)
  emit(kind === 'split-final' ? [[partial, true], ['140 over 90 this morning', true]] : [[full, true]])
  await flush(); assert.deepEqual(calls, [])
  await advance(1999); assert.deepEqual(calls, [])
  await advance(1); await advance(0)
  assert.equal(Date.now(), 75300)
  assert.equal(captions.size, 1)
  const segment = [...captions.values()][0]
  assert.equal(segment.en, full); assert.equal(segment.zh, zh); assert.equal(segment.status, 'done')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].includes('140'))
  console.log(`${provider}/${kind}: 71.5s requests 0; 73.3s requests 0; 75.3s requests 1, full 140/90 only`)
})

test('preview APIs reject before invoking either local model or fallback', async () => {
  let calls = 0
  const local = { translate: async () => { calls++; return '我的血壓是' } }
  const options = { preview: true }; const signal = new AbortController().signal
  await assert.rejects(localTranslation(local, partial, signal, [], options), { code: 'previews_disabled' })
  await assert.rejects(translateWithFallback(local, partial, signal, () => {}, [], options, async () => { calls++ }), { code: 'previews_disabled' })
  await assert.rejects(networkTranslation(partial, signal, () => {}, [], options), { code: 'previews_disabled' })
  assert.equal(calls, 0)
})

test('interims saved at end, restored old translated interims and queued unstable finals never translate', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const captions = new Map(); let calls = 0
  const queue = createTranslationQueue({ find: id => captions.get(id), online: () => true, execute: async () => { calls++ } })
  const rec = { start() {}, stop() {} }
  const controller = createSpeechController(rec, {
    commit(en, metadata) { captions.set(1, { id: 1, en, status: 'pending', ...metadata }); queue.enqueue(1); return 1 },
    revise(id, en, metadata) { Object.assign(captions.get(id), { en, ...metadata }); queue.enqueue(id) }, preview() {}, state() {}, message() {}
  })
  t.after(() => { controller.dispose(); queue.dispose() })
  controller.start(); rec.onresult({ results: [Object.assign([{ transcript: partial }], { isFinal: false })] })
  t.mock.timers.tick(1200); await controller.finish(); rec.onend(); t.mock.timers.tick(10000); await flush()
  assert.equal(calls, 0); assert.equal(captions.get(1).forced, true)
  const restored = recoverSegment({ id: 2, en: partial, status: 'done', zh: '我的血壓是', provisional: true, timestamp: 0 })
  assert.equal(restored.zh, ''); assert.equal(restored.status, 'pending')
  assert.ok(!formatTranscript([{ ...restored, zh: '我的血壓是', status: 'done' }]).includes('我的血壓是'))
  captions.set(2, restored); queue.enqueue(2)
  captions.set(3, { id: 3, en: full, timestamp: 0, status: 'pending', settled: true }); queue.enqueue(3)
  captions.get(3).settled = false
  t.mock.timers.tick(0); await flush(); assert.equal(calls, 0)
})

test('reload resumes a complete Chrome-final caption without promoting saved interims or incomplete finals', () => {
  assert.equal(translationReady(recoverSegment({ en: full, zh: '', status: 'pending', settled: false })), true)
  for (const metadata of [{ provisional: true }, { forced: true }, {}]) {
    assert.equal(translationReady(recoverSegment({ en: partial, zh: '', status: 'pending', settled: false, ...metadata })), false)
  }
})

test('an unrelated final cannot promote a retained dangling interim into translatable final text', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const captions = []; const rec = { start() {}, stop() {} }
  const controller = createSpeechController(rec, {
    commit(en, metadata) { captions.push({ en, ...metadata }); return captions.length - 1 },
    revise(id, en, metadata) { Object.assign(captions[id], { en, ...metadata }) }, preview() {}, state() {}, message() {}
  })
  t.after(() => controller.dispose())
  controller.start()
  rec.onresult({ results: [Object.assign([{ transcript: partial }], { isFinal: false })] })
  t.mock.timers.tick(1200)
  rec.onresult({ results: [Object.assign([{ transcript: 'Can I pay with my mobile phone?' }], { isFinal: true })] })
  t.mock.timers.tick(3000)
  assert.equal(captions.length, 2)
  assert.equal(captions[0].en, partial); assert.equal(translationReady(captions[0]), false)
  assert.equal(captions[1].en, 'Can I pay with my mobile phone?'); assert.equal(translationReady(captions[1]), true)
})

test('a Chrome correction beyond the stability window invalidates and extends the same caption', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const captions = []; const rec = { start() {}, stop() {} }
  const controller = createSpeechController(rec, {
    commit(en, metadata) { captions.push({ en, ...metadata }); return captions.length - 1 },
    revise(id, en, metadata) { Object.assign(captions[id], { en, ...metadata }) }, preview() {}, state() {}, message() {}
  })
  t.after(() => controller.dispose())
  controller.start()
  const emit = transcript => rec.onresult({ results: [Object.assign([{ transcript }], { isFinal: true })] })
  emit('The medicine helped'); t.mock.timers.tick(2500)
  assert.equal(translationReady(captions[0]), true)
  emit('The medicine helped reduce my headache.')
  assert.equal(captions.length, 1)
  assert.equal(captions[0].en, 'The medicine helped reduce my headache.')
  assert.equal(translationReady(captions[0]), false)
  t.mock.timers.tick(2000); assert.equal(translationReady(captions[0]), true)
})
