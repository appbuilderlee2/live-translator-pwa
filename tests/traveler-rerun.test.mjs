import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { reviseRecognizedSegment } from '../src/transcript.mjs'
import { seatingSource, seatingMismatch } from '../shared/coverage.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { translateHandler } from './handler-fixture.mjs'

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
const seating = 'Is there a comfortable place to sit near the metro station?'
const passage = `Please take the Taipei Metro to Taipei Main Station. ${seating} If the ticket costs $25, can I pay by mobile phone? Please let me know when the last train leaves.`
const request = text => new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text }) })

test('rapid suffix replacements across restart preserve observed fares but never invent absent turns', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const captions = new Map(); let id = 0; let results = []
  const rec = { start() { results = []; this.onstart?.() }, stop() { this.onend() } }
  const speech = createSpeechController(rec, {
    commit(en, metadata) { const key = ++id; captions.set(key, { id: key, en, ...metadata }); return key },
    revise(id, en, metadata) { captions.set(id, reviseRecognizedSegment(captions.get(id), en, metadata)) },
    preview() {}, state() {}, message() {}
  })
  t.after(() => speech.dispose())
  const emit = (index, rows, final = false) => {
    results.splice(index, results.length - index, ...rows.map(transcript => Object.assign([{ transcript, confidence: .9 }], { isFinal: final })))
    rec.onresult({ resultIndex: index, results }); t.mock.timers.tick(300)
  }
  speech.start()
  for (let run = 0; run < 2; run++) {
    emit(0, ['the subway', 'leaves at 6:30'])
    emit(0, ['the subway leaves at 6:30'], true)
    emit(1, ['the ticket costs', '$25'])
    emit(1, ['the ticket costs $25'])
    emit(1, ['can I pay with my mobile phone'])
    emit(1, ['can I pay with my mobile phone'], true)
    t.mock.timers.tick(3000)
    if (!run) rec.onend()
  }
  emit(2, ['the']); emit(2, ['the']); emit(2, ['and'])
  emit(2, ['and I pay', 'with my'])
  speech.stop(); t.mock.timers.tick(10000)
  const segments = [...captions.values()]
  for (const source of ['the subway leaves at 6:30', 'the ticket costs $25', 'can I pay with my mobile phone']) assert.equal(segments.filter(s => s.en === source).length, 2)
  assert.equal(segments.filter(s => s.en === 'and I pay with my').length, 1)
  assert.equal(segments.length, 7)
  assert.ok(segments.filter(s => /ticket|and I pay/.test(s.en)).every(s => s.unconfirmed && s.settled && !s.provisional))
})

test('seating source canonicalization preserves counts and dependent clauses', () => {
  assert.equal(seatingSource(seating), 'Is there a comfortable seat near the metro station?')
  assert.equal(seatingSource('We need two places to sit by the gate.'), 'We need two seats by the gate.')
  assert.equal(seatingSource('Is there a place to sit down?'), 'Is there a seat?')
  for (const text of ['', 'Sit near the gate.', 'A place to sit an exam.', 'A place to sit while we wait.', 'A place to sit and wait.']) assert.equal(seatingSource(text), text)
  assert.ok(seatingMismatch(seating, '地鐵站附近有舒服的地方嗎？'))
})

test('Google seating omission recovers for single sentences and complete passages without dropping currency', async t => {
  const original = fetch; const key = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key !== undefined) process.env.OPENAI_API_KEY = key })
  const queries = []
  globalThis.fetch = async url => {
    const query = new URL(url).searchParams.get('q'); queries.push(query)
    const seat = query.includes('comfortable seat near') ? '捷運站附近有舒服的座位嗎？' : '捷運站附近有舒服的地方嗎？'
    const output = query.includes('__CURRENCY_UNIT__') ? `請搭乘臺北捷運至臺北車站。${seat}如果票價為25 __CURRENCY_UNIT__，我可以用手機付款嗎？請通知我末班車何時出發。` : seat
    return Response.json([[[output]]])
  }
  for (const source of [seating, passage]) {
    const response = await translateHandler(request(source)); assert.equal(response.status, 200)
    const translated = await response.text(); assert.match(translated, /座位/)
    if (source === passage) { assert.match(translated, /25\s*元/); assert.match(translated, /臺北車站/); assert.match(translated, /末班車/); assert.doesNotMatch(translated, /美元|__CURRENCY/) }
  }
  assert.equal(queries.length, 2); assert.ok(queries.every(q => !q.includes('place to sit')))
  assert.match(queries[1], /25,?\s*__CURRENCY_UNIT__/)
  globalThis.fetch = async () => Response.json([[['捷運站附近有舒服的地方嗎？']]])
  const invalid = await translateHandler(request(seating))
  assert.equal(invalid.status, 502); assert.equal((await invalid.json()).error, 'upstream_invalid_response')
  const empty = await translateHandler(request('')); assert.equal(empty.status, 400)
})

for (const code of ['upstream_invalid_response', 'translation_invalid']) test(`persistent ${code} blocks newer captions until the oldest succeeds`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const segments = new Map([1, 2].map(id => [id, { id, en: `caption ${id}`, timestamp: id, status: 'pending' }]))
  let recover = false; const calls = []; const completed = []; const state = new Map()
  const storage = { getItem: key => state.get(key), setItem: (key, value) => state.set(key, value) }
  const queue = createTranslationQueue({ find: id => segments.get(id), online: () => true, storage, execute: async segment => {
    calls.push(segment.id)
    if (segment.id === 1 && !recover) throw Object.assign(new Error('invalid'), { code })
    segment.status = 'done'; completed.push(segment.id)
  } })
  t.after(() => queue.dispose())
  queue.enqueue(2); queue.enqueue(1)
  for (const delay of [0, 5500, 10000, 20000, 40000, 60000]) { t.mock.timers.tick(delay); await flush(); queue.wake(); queue.enqueue(2) }
  assert.deepEqual(calls, [1, 1, 1, 1, 1, 1]); assert.deepEqual(completed, [])
  assert.equal(Number(state.get('lt-provider-retry-at')), Date.now() + 60000)
  recover = true; t.mock.timers.tick(60000); await flush()
  assert.deepEqual(completed, [1]); t.mock.timers.tick(5500); await flush()
  assert.deepEqual(completed, [1, 2]); assert.equal(calls.length, 8)
})

test('terminal failures release the next caption and empty queues issue no work', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const segments = new Map([1, 2].map(id => [id, { id, en: 'Hello.', timestamp: id, status: 'pending' }]))
  const calls = []
  const queue = createTranslationQueue({ find: id => segments.get(id), online: () => true, execute: async segment => {
    calls.push(segment.id)
    if (segment.id === 1) throw Object.assign(new Error('terminal'), { retryable: false })
    segment.status = 'done'
  } })
  t.after(() => queue.dispose())
  t.mock.timers.tick(10000); await flush(); assert.deepEqual(calls, [])
  queue.enqueue(1); queue.enqueue(2); t.mock.timers.tick(0); await flush()
  t.mock.timers.tick(5500); await flush(); assert.deepEqual(calls, [1, 2])
})
