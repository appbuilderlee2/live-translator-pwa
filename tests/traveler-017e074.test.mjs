import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { recoverSegment, reviseRecognizedSegment } from '../src/transcript.mjs'
import { literalCurrency, protectCurrency, currencySource } from '../shared/business.mjs'
import { readableChinese } from '../shared/phrasing.mjs'
import { semanticMismatch, seatingMismatch } from '../shared/coverage.mjs'
import { translateWithFallback } from '../src/local.mjs'
import { networkTranslation } from '../src/network.mjs'
import { translateHandler } from './handler-fixture.mjs'

const drain = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
const source = 'Please take the Taipei Metro to Taipei Main Station. Is there a comfortable place to sit near the metro station? If the ticket costs $25, can I pay by mobile phone? Please let me know when the last train leaves.'
const missingSeat = '請搭乘臺北捷運至臺北車站。捷運站附近有舒服的地方嗎？如果票價為 25，元 我可以透過手機支付嗎？請通知我最後一班火車何時出發。'
const correct = '請搭乘臺北捷運至臺北車站。捷運站附近有可以舒服坐下的地方嗎？如果票價為 25元，我可以透過手機支付嗎？請通知我最後一班火車何時出發。'

for (const nativeFare of [true, false]) test(`quick-turn departure/fare/phone preserve every source and translate once (fare final ${nativeFare})`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const captions = new Map(); const calls = []; let id = 0; let pending
  const queue = createTranslationQueue({ find: id => captions.get(id), online: () => true, changed: state => { pending = state.pending }, execute: async segment => {
    calls.push(segment.en); captions.set(segment.id, { ...segment, status: 'done', zh: '翻譯完成。' })
  } })
  const rec = { start() {}, stop() { this.onend() } }
  const controller = createSpeechController(rec, {
    commit(en, metadata) { const key = ++id; captions.set(key, { id: key, en, timestamp: id, status: 'pending', ...metadata }); queue.enqueue(key); return key },
    revise(id, en, metadata) { captions.set(id, reviseRecognizedSegment(captions.get(id), en, metadata)); queue.enqueue(id) },
    preview() {}, state() {}, message() {}
  })
  t.after(() => { controller.dispose(); queue.dispose() })
  const departure = ['Subway leaves at 6:30', true]
  const fare = ['the ticket costs $25', nativeFare]
  const phone = ['can I pay with my mobile phone', true]
  const emit = rows => rec.onresult({ results: rows.map(([text, final]) => Object.assign([{ transcript: text, confidence: .97 }, { transcript: text, confidence: .9 }], { isFinal: final })) })
  controller.start(); emit([departure]); t.mock.timers.tick(1000)
  emit([departure, ['the ticket costs', false], ['$25', false]]); t.mock.timers.tick(100)
  emit([departure, fare]); t.mock.timers.tick(1300)
  emit(nativeFare ? [departure, fare, phone] : [departure, phone])
  for (let i = 0; i < 8; i++) { t.mock.timers.tick(6000); await drain() }
  assert.deepEqual(calls, nativeFare ? [departure[0], fare[0], phone[0]] : [departure[0], phone[0]])
  controller.stop()
  for (let i = 0; i < 8; i++) { t.mock.timers.tick(6000); await drain() }
  assert.equal(captions.size, 3); assert.equal(pending, 0)
  assert.deepEqual([...captions.values()].map(s => s.en), [departure[0], fare[0], phone[0]])
  assert.equal(calls.length, 3); assert.equal(new Set(calls).size, 3)
  assert.equal([...captions.values()][1].unconfirmed, !nativeFare)
  console.log(`Quick turns, fare final ${nativeFare}: 3 preserved captions; 3 requests; 0 pending; 0 duplicate sources`)
})

test('standalone bare currency is deterministic locally and on either server provider, with no upstream request', async t => {
  const original = fetch; const key = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('Provider must not run for a currency literal') }
  for (const [text, expected] of [['$25', '25 元'], ['$12.50', '12.50 元'], ['$1,250', '1,250 元'], ['25 dollars', '25 元'], ['$0', '0 元']]) {
    assert.equal(literalCurrency(text), expected)
    for (const provider of ['Google', 'OpenAI']) {
      if (provider === 'Google') delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = 'test'
      const response = await translateHandler(new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text }) }))
      assert.equal(response.status, 200); assert.equal(await response.text(), expected)
    }
    const updates = []
    assert.equal(await translateWithFallback({ translate() { calls++ } }, text, new AbortController().signal, text => updates.push(text)), expected)
    assert.deepEqual(updates, [expected])
  }
  assert.equal(calls, 0)
  for (const text of ['', '$', '$1,23', 'US$25', '25 US dollars', 'The ticket costs $25']) assert.equal(literalCurrency(text), null)
  assert.throws(() => protectCurrency(currencySource('$25')).restore('25'), /Currency placeholder was lost/)
  const response = await translateHandler(new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text: '$25', preview: true }) }))
  assert.equal(response.status, 409)
  const aborted = new AbortController(); aborted.abort()
  await assert.rejects(translateWithFallback(null, '$25', aborted.signal, () => {}), { name: 'AbortError' })
})

test('amount punctuation and sitting semantics survive local fallback, client validation and restored history', async t => {
  const original = fetch
  t.after(() => { globalThis.fetch = original })
  assert.equal(readableChinese('If the ticket costs $25, can I pay?', '如果票價為 25，元，我可以付款嗎？'), '如果票價為 25元，我可以付款嗎？')
  assert.equal(readableChinese('It costs 25 US dollars.', '費用為25，美元。'), '費用為25美元。')
  assert.equal(readableChinese('', ''), '')
  assert.equal(readableChinese('Choose 25, then a unit.', '選擇25，元件另計。'), '選擇25，元件另計。')
  assert.ok(recoverSegment({ en: source, zh: correct.replace('25元', '25，元'), status: 'done' }).zh.includes('25元'))
  assert.equal(semanticMismatch(source, missingSeat), true)
  assert.equal(semanticMismatch(source, correct), false)
  assert.equal(seatingMismatch('Park the car.', '請停車。'), false)
  assert.equal(seatingMismatch('', ''), false)
  let fallbacks = 0
  const translated = await translateWithFallback({ translate: async () => missingSeat }, source, new AbortController().signal, () => {}, [], {}, async text => {
    assert.equal(text, source); fallbacks++; return correct
  })
  assert.equal(translated, correct); assert.equal(fallbacks, 1)
  globalThis.fetch = async () => new Response(missingSeat)
  await assert.rejects(networkTranslation(source, new AbortController().signal, () => {}), { code: 'translation_invalid' })
  globalThis.fetch = async () => new Response(correct)
  assert.equal(await networkTranslation(source, new AbortController().signal, () => {}), correct)
  globalThis.fetch = async () => new Response('請停車。')
  assert.equal(await networkTranslation('Park the car.', new AbortController().signal, () => {}), '請停車。')
})

test('server rejects provider output that loses the comfortable-place-to-sit meaning', async t => {
  const original = fetch; const key = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  for (const provider of ['Google', 'OpenAI']) {
    if (provider === 'Google') delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = 'test'
    for (const good of [false, true]) {
      const answer = good ? '捷運站附近有可以舒服坐下的地方嗎？' : '捷運站附近有舒服的地方嗎？'
      globalThis.fetch = async () => provider === 'Google' ? Response.json([[[answer]]]) : new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`)
      const response = await translateHandler(new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text: 'Is there a comfortable place to sit near the metro station?' }) }))
      if (good) { assert.equal(response.status, 200); assert.equal(await response.text(), answer) }
      else if (provider === 'Google') { assert.equal(response.status, 502); assert.equal((await response.json()).error, 'upstream_invalid_response') }
      else await assert.rejects(response.text(), /omitted source meaning/)
    }
    globalThis.fetch = async () => provider === 'Google' ? Response.json([[['請停車。']]]) : new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '請停車。' } }] })}\n\ndata: [DONE]\n\n`)
    const response = await translateHandler(new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text: 'Park the car.' }) }))
    assert.equal(response.status, 200); assert.equal(await response.text(), '請停車。')
  }
})
