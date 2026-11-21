import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { recoverSegment, reviseRecognizedSegment, translationReady } from '../src/transcript.mjs'
import { captionState } from '../src/translation-state.mjs'
import { localChunks, localTranslation, translateWithFallback, coverageMismatch } from '../src/local.mjs'
import { semanticMismatch } from '../shared/coverage.mjs'
import { readableChinese, speechClauses } from '../shared/phrasing.mjs'
import { networkTranslation } from '../src/network.mjs'

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
const signal = () => new AbortController().signal

function queueHarness(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const captions = new Map(); const requests = []; let queue; let id = 0
  const original = fetch; let inFlight = 0; let maximum = 0
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    const segment = [...captions.values()].find(row => row.en === body.text)
    requests.push({ id: segment.id, en: body.text, provisional: !translationReady(segment) })
    assert.ok(!body.preview)
    maximum = Math.max(maximum, ++inFlight)
    await Promise.resolve(); inFlight--
    return new Response(body.text.includes('blood pressure') ? '今天早上我的血壓是140/90。' : body.text.includes('did not help') ? '藥物沒有幫助。' : '測試譯文。')
  }
  const storage = new Map()
  const persisted = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }
  const makeQueue = () => createTranslationQueue({ find: key => captions.get(key), online: () => true, storage: persisted, execute: async segment => {
    const zh = await networkTranslation(segment.en, signal(), () => {}, [], { spoken: true })
    captions.set(segment.id, { ...segment, zh, status: 'done', translation: { source: segment.en, text: zh } })
  } })
  queue = makeQueue()
  t.after(() => { queue.dispose(); globalThis.fetch = original })
  return {
    captions, requests, maximum: () => maximum,
    commit(en, metadata, key = String(++id)) { captions.set(key, { id: key, en, zh: '', status: 'pending', timestamp: Date.now(), ...metadata }); queue.enqueue(key); return key },
    revise(key, en, metadata) { captions.set(key, reviseRecognizedSegment(captions.get(key), en, metadata)); queue.enqueue(key) },
    async advance(ms) { for (let remaining = ms; remaining > 0;) { const step = Math.min(remaining, 100); t.mock.timers.tick(step); await flush(); remaining -= step } t.mock.timers.tick(0); await flush() },
    retry() { for (const key of captions.keys()) queue.enqueue(key); queue.wake() },
    reload() { queue.dispose(); for (const [key, value] of captions) captions.set(key, recoverSegment(JSON.parse(JSON.stringify(value)))); queue = makeQueue(); for (const key of captions.keys()) queue.enqueue(key) }
  }
}

for (const gap of [7220, 5600]) test(`edge report: provisional/full transition ${gap}ms apart makes one settled request`, async t => {
  const h = queueHarness(t)
  const partial = 'Good morning I am visiting Taiwan for the first time please tell me where the nearest train station is I would like to buy'
  const full = `${partial} a ticket and find a quiet place to have breakfast before the museum opens`
  const rec = { start() {}, stop() {} }
  const controller = createSpeechController(rec, { commit: h.commit, revise: h.revise, preview() {}, state() {}, message() {} })
  t.after(() => controller.dispose()); controller.start()
  const emit = (text, isFinal) => rec.onresult({ results: [Object.assign([{ transcript: text, confidence: .99 }], { isFinal })] })
  await h.advance(8450); emit(partial, false); await h.advance(1200)
  assert.equal(h.requests.length, 0)
  await h.advance(gap); emit(full, true); await h.advance(2000)
  h.retry(); h.reload(); await h.advance(20000)
  assert.equal(h.captions.size, 1); assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].en, full); assert.equal(h.requests[0].provisional, false)
  console.log(`Edge report-derived ${gap}ms transition: captions 1; requests 1; provisional 0; reload/retry extra 0`)
})

test('elderly report: seven duplicate-pair schedules plus thirteen final-only controls make twenty requests', async t => {
  const h = queueHarness(t)
  const pairs = [
    ['65a3ef0b-2fe8-457b-a729-64cfd0307257', 0, 5571],
    ['daf7e84a-b476-47b9-a9fb-e7355c6390fb', 11134, 16702],
    ['ff89f491-6f97-4f39-bb0f-820dcafff131', 22301, 27873],
    ['35e05a45-b49d-4a54-bdb2-e86a5b444a5d', 36078, 42933],
    ['cd30f811-d182-4839-81b6-c4f90135389a', 52499, 58067],
    ['2e5053fa-5ae2-456e-bfa2-11b258638afc', 82738, 90230],
    ['64c8af4c-3592-42e6-bfb0-fe6690bf0650', 122008, 127669]
  ]
  const events = pairs.flatMap(([id, first, second], index) => [
    [first, () => h.commit(index === 1 ? 'my blood pressure was' : `reported caption ${index} incomplete`, { provisional: true, settled: false }, id)],
    [second, () => h.revise(id, index === 1 ? 'my blood pressure was 140 over 90 this morning' : `reported caption ${index} completed`, { provisional: index === 2, settled: index !== 2 })],
    ...(index === 2 ? [[second + 2000, () => h.revise(id, `reported caption ${index} completed`, { provisional: false, settled: true })]] : [])
  ])
  for (let i = 0; i < 13; i++) events.push([i * 10000 + 60000, () => h.commit(`final-only control ${i}`, { provisional: false, settled: true })])
  events.sort((a, b) => a[0] - b[0])
  for (const [at, apply] of events) { await h.advance(at - Date.now()); apply(); h.retry() }
  await h.advance(120000); h.reload(); h.retry(); await h.advance(60000)
  assert.equal(h.captions.size, 20); assert.equal(h.requests.length, 20)
  assert.equal(h.maximum(), 1)
  assert.ok([...h.captions.keys()].every(id => h.requests.filter(row => row.id === id).length === 1))
  assert.ok(h.requests.every(row => !row.provisional))
  console.log('Elderly report-derived schedules: 7 reported ID pairs + 13 final-only controls; captions 20; requests 20; per-caption min/max 1/1; provisional 0; reload/retry extra 0')
})

test('completed same-source translation survives readiness regression, punctuation-only correction and reload; genuine changed content is translated', async t => {
  const h = queueHarness(t)
  const id = h.commit('The medicine helped', { settled: true })
  await h.advance(1); assert.equal(h.requests.length, 1)
  h.revise(id, 'The medicine helped', { provisional: true, settled: false })
  assert.equal(h.captions.get(id).zh, '')
  h.reload(); h.retry(); await h.advance(10000); assert.equal(h.requests.length, 1)
  h.revise(id, 'The medicine helped.', { provisional: false, settled: true })
  assert.equal(h.captions.get(id).status, 'done'); assert.equal(h.captions.get(id).zh, '測試譯文。')
  h.retry(); h.reload(); await h.advance(10000); assert.equal(h.requests.length, 1)
  assert.equal(reviseRecognizedSegment(h.captions.get(id), 'The medicine helped?', { settled: true }).status, 'pending')
  assert.equal(reviseRecognizedSegment({ en: 'The dose is 1.5', zh: '劑量是 1.5', status: 'done' }, 'The dose is 15', { settled: true }).status, 'pending')
  h.revise(id, 'The medicine did not help.', { settled: true })
  assert.equal(h.captions.get(id).zh, '')
  await h.advance(5500); assert.equal(h.requests.length, 2)
})

test('caption states distinguish online queue, cooldown, offline, terminal errors and successful recovery', () => {
  const pending = { en: 'Hello', status: 'pending' }
  assert.match(captionState(pending, true).label, /Queued for translation/)
  for (const status of ['pending', 'error']) {
    const busy = captionState({ ...pending, status }, true, { pending: 2, retryAt: Date.now() + 12000, reason: 'provider_cooldown' })
    assert.match(busy.label, /Translation service busy, retrying automatically/); assert.equal(busy.manualRetry, false)
    assert.doesNotMatch(busy.placeholder, /等待連線|Interrupted/)
  }
  assert.match(captionState(pending, false).label, /resumes online/)
  assert.equal(captionState({ ...pending, status: 'error', retryable: false }, true).manualRetry, true)
  const done = captionState({ ...pending, status: 'done' }, true)
  assert.match(done.label, /Translated/); assert.equal(done.manualRetry, false)
  assert.match(captionState({ ...pending, provisional: true }, true).label, /Awaiting final/)
})

const hospital = 'the weather is warm today but it may rain later in the afternoon I would like to take a taxi to the hospital my friend needs some water and a comfortable place to sit while we wait'
const family = 'My grandson will visit on Sunday afternoon at two thirty. Please call me when you arrive at the station. We can have a simple dinner at home. There are four people coming, and one of them does not eat meat.'
const dense = '我的孫子會在週日下午2:30來探望，到站後給我打電話我們可以在家吃一頓簡單的晚餐有四個人來，其中一個不吃肉'

test('generic seating coverage catches the reported hospital omission and falls back with the full caption', async () => {
  const calls = []; let fallbacks = 0; const updates = []
  const local = { translate: async chunk => { calls.push(chunk); return /\bsit\b/.test(chunk) ? '我的朋友需要一些水和一個舒適的地方來等待我們等待' : '今天天氣溫暖，下午可能下雨，我想搭計程車去醫院' } }
  const fallback = async text => { assert.equal(text, hospital); fallbacks++; return '我的朋友需要一些水和舒適的座位。' }
  assert.equal(await translateWithFallback(local, hospital, signal(), text => updates.push(text), [], {}, fallback), '我的朋友需要一些水和舒適的座位。')
  assert.equal(fallbacks, 1); assert.deepEqual(updates, [])
  assert.ok(calls.some(chunk => /comfortable place to sit/.test(chunk)))
  for (const source of ['Please sit near the window.', 'A visitor needs a seat.', 'They are sitting together.']) {
    assert.equal(semanticMismatch(source, '在窗邊等待'), true)
    assert.equal(semanticMismatch(source, '請坐在窗邊的座位'), false)
  }
  assert.equal(semanticMismatch('Please wait near the window.', '在窗邊等待'), false)
  assert.equal(coverageMismatch(hospital, '天氣溫暖，下午可能下雨，我想搭計程車去醫院，我的朋友需要一些水和一個舒適的地方來等待我們等待'), true)
  assert.equal(localChunks(hospital).join(' '), hospital)
  const correct = await localTranslation({ translate: async chunk => /\bsit\b/.test(chunk) ? '我的朋友需要一些水和一個舒適的地方坐下等待' : '今天天氣溫暖，下午可能下雨，我想搭計程車去醫院' }, hospital, signal())
  assert.match(correct, /坐下/)
})

test('report family output gains safe sentence boundaries without changing time/quantities, repeated formatting or existing punctuation', async t => {
  const original = fetch; t.after(() => { globalThis.fetch = original })
  const expected = '我的孫子會在週日下午2:30來探望，到站後給我打電話。我們可以在家吃一頓簡單的晚餐。有四個人來，其中一個不吃肉。'
  assert.equal(recoverSegment({ en: family, zh: dense, status: 'done' }).zh, expected)
  for (const source of [family, family.replace(/[.,]/g, '').toLowerCase()]) {
    assert.equal(readableChinese(source, dense), expected)
    assert.equal(readableChinese(source, expected), expected)
    assert.equal(readableChinese(source, ''), '')
    assert.equal(readableChinese(source, '2:30，12.50，140/90。'), '2:30，12.50，140/90。')
    globalThis.fetch = async () => new Response(dense)
    const updates = []
    assert.equal(await networkTranslation(source, signal(), text => updates.push(text)), expected)
    assert.equal(updates.at(-1), expected)
  }
  assert.equal(readableChinese(family, '他希望我們可以在家吃飯。'), '他希望我們可以在家吃飯。')
  assert.equal(readableChinese(family, '他告訴我有四個人來。'), '他告訴我有四個人來。')
  assert.equal(readableChinese(hospital, '今天天氣溫暖但下午可能下雨我想搭計程車去醫院我的朋友需要一些水和舒適的地方坐下等待'), '今天天氣溫暖但下午可能下雨。我想搭計程車去醫院。我的朋友需要一些水和舒適的地方坐下等待。')
  assert.deepEqual(speechClauses('I hope we can have dinner together'), ['I hope we can have dinner together'])
  assert.equal(readableChinese('Hello', '你好'), '你好')
  assert.equal(readableChinese(`${family}?`, '我們要先打電話嗎'), '我們要先打電話嗎？')
  globalThis.fetch = async () => new Response('我們可以吃肉。')
  await assert.rejects(networkTranslation(family, signal(), () => {}), /Negation/)
})

test('on-device joins independent clauses with punctuation, not arbitrary 120-character cuts', async () => {
  const source = 'Please bring some water. Please bring a comfortable chair.'
  assert.equal(await localTranslation({ translate: async chunk => chunk.includes('water') ? '請帶一些水' : '請帶一張舒適的椅子' }, source, signal()), '請帶一些水。 請帶一張舒適的椅子。')
  assert.equal(readableChinese('', ''), '')
  assert.equal(readableChinese(), '')
  assert.equal(readableChinese(undefined, '舊資料'), '舊資料')
  const long = 'A speaker repeats an ordinary description of daily events and plans for the next season '.repeat(5).trim()
  const result = await localTranslation({ translate: async () => '這是一段連續而且沒有結束也不應隨意切斷的中文敘述' }, long, signal())
  assert.doesNotMatch(result, /。 /)
  assert.ok(result.endsWith('。'))
})
