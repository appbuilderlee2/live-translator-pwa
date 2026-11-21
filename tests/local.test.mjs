import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { coverageMismatch, localChunks, localTranslation, translateWithFallback } from '../src/local.mjs'
import { negationMismatch } from '../shared/negation.mjs'

const recognized = 'tomorrow morning hour train leave at 9:15 we need four bottles of water and two sandwiches for the journey please help us find platform 6 thank you for speaking slowly and explaining the directions so clearly'
const truncated = '明天早上 9:15 火車出發 我們需要四瓶水和兩個三明治'
const full = '明天早上 9 點 15 分火車出發，我們需要四瓶水和兩個三明治，請幫我們找到 6 號月臺，謝謝您說得很慢，並且解釋得這麼清楚'
const signal = () => new AbortController().signal

test('hurry negation retains its scope and unrelated route hallucinations fall back with the full caption', async () => {
  const short = 'we are not in a hurry'
  const hallucinated = '我們不是最安全的步行路線'
  const paragraph = 'after lunch we plan to visit the library and the park could you show us the safest walking route on the map we are not in a hurry we would rather walk slowly and enjoy the street'
  assert.equal(negationMismatch(short, hallucinated), true)
  assert.equal(negationMismatch(short, '我們不趕時間'), false)
  assert.equal(coverageMismatch(short, hallucinated), true)
  assert.ok(localChunks(paragraph).includes(short))
  assert.equal(localChunks(paragraph).join(' '), paragraph)
  const calls = []
  for (const source of [short, paragraph]) {
    const fallback = async (text, _signal, update) => { calls.push(text); update('我們不趕時間'); return '我們不趕時間' }
    const result = await translateWithFallback({ translate: async () => hallucinated }, source, signal(), () => {}, [], {}, fallback)
    assert.equal(result, '我們不趕時間')
  }
  assert.deepEqual(calls, [short, paragraph])
})

test('concurrent captions use the shared local translator serially without cross-caption input', async () => {
  const calls = []; let active = 0; let maximum = 0
  const local = { async translate(text) { calls.push(text); maximum = Math.max(maximum, ++active); await Promise.resolve(); active--; return text === 'Hello' ? '你好' : '謝謝' } }
  assert.deepEqual(await Promise.all([localTranslation(local, 'Hello', signal()), localTranslation(local, 'Thank you', signal())]), ['你好', '謝謝'])
  assert.deepEqual(calls, ['Hello', 'Thank you']); assert.equal(maximum, 1)
})

test('Taipei destination and trailing figures must survive local output; accepted output gets Taiwan normalization', async () => {
  const source = 'Please take a taxi to the Taipei subway station.'
  let calls = 0
  const fallback = async text => { assert.equal(text, source); calls++; return '請搭計程車到臺北捷運站。' }
  const updates = []
  for (const output of ['請搭乘計程車到中華', '請搭計程車到臺北', '']) {
    assert.equal(await translateWithFallback({ translate: async () => output }, source, signal(), text => updates.push(text), [], {}, fallback), '請搭計程車到臺北捷運站。')
  }
  assert.equal(calls, 3)
  assert.equal(await localTranslation({ translate: async () => '请搭计程车到台北地铁站。' }, source, signal()), '請搭計程車到臺北捷運站。')
  assert.equal(coverageMismatch('Please take a taxi to the Taipei subway station at 6:30 for $25.', '請搭計程車到臺北捷運站。'), true)
  assert.equal(await localTranslation({ translate: async () => '社群健走活動，請請慢慢看看。' }, 'Community walking event with a slow look.', signal()), '社區健走活動，請慢慢看看。')
})

test('local bare-dollar units are neutral or fall back; explicit US currency is preserved', async () => {
  for (const spoken of [false, true]) {
    const local = { translate: async source => { assert.match(source, /25 __CURRENCY_UNIT__/); return '票價 25 __CURRENCY_UNIT__' } }
    assert.equal(await localTranslation(local, 'The ticket costs $25', signal(), [], { spoken }), '票價 25 元')
    let calls = 0
    const fallback = async (text, _signal, _update, _context, options) => { calls++; assert.equal(text, 'The ticket costs $25'); assert.equal(options.spoken, spoken); return '票價 25 元' }
    assert.equal(await translateWithFallback({ translate: async () => '票價 25 美元' }, 'The ticket costs $25', signal(), () => {}, [], { spoken }, fallback), '票價 25 元')
    assert.equal(calls, 1)
  }
  assert.equal(await localTranslation({ translate: async () => '票價 25 美元' }, 'The ticket costs US$25', signal()), '票價 25 美元')
})

test('chunks the supplied five-paragraph passage without dropping words; handles unpunctuated late final', async () => {
  const passage = await readFile(new URL('./edge-v3-passage.txt', import.meta.url), 'utf8')
  const chunks = localChunks(passage)
  assert.ok(chunks.every(chunk => chunk.length <= 120))
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), passage.trim().replace(/\s+/g, ' '))
  assert.equal(localChunks(recognized).length, 4)
  assert.equal(localChunks(recognized).join(' '), recognized)
  assert.deepEqual(localChunks(''), [])
  assert.equal(coverageMismatch(recognized, truncated), true)
  assert.equal(coverageMismatch(recognized, full), false)
  assert.equal(coverageMismatch('thank you for speaking slowly and explaining the directions so clearly', '謝謝'), true)
  assert.equal(coverageMismatch('Hello', ''), true)
  assert.equal(coverageMismatch('Thank you', '謝謝'), false)
})

test('on-device translates every clause of the reported final, including platform 6 and the closing thanks', async () => {
  const calls = []
  const local = { async translate(chunk) {
    calls.push(chunk)
    if (/train/.test(chunk)) return '明天早上 9:15 火車出發'
    if (/we need/.test(chunk)) return '我們需要四瓶水和兩個三明治，以供旅途使用'
    if (/platform/.test(chunk)) return '請幫我們找到 6 號月臺'
    return '謝謝您說得很慢，並且解釋得這麼清楚'
  } }
  const result = await localTranslation(local, recognized, signal())
  assert.deepEqual(calls, localChunks(recognized)); assert.match(result, /6 號月臺/); assert.match(result, /謝謝/)
  assert.equal(coverageMismatch(recognized, result), false)
})

test('truncated, empty, or failed on-device results fall back to the server with the entire original caption', async t => {
  const original = fetch; const updates = []; const requests = []
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); return new Response(full) }
  for (const output of [truncated, '', new Error('model failed')]) {
    const local = { async translate() { if (output instanceof Error) throw output; return output } }
    assert.equal(await translateWithFallback(local, recognized, signal(), text => updates.push(text), [], { spoken: true }), full)
  }
  assert.equal(requests.length, 3)
  assert.ok(requests.every(body => body.text === recognized && body.spoken === true))
  assert.ok(updates.every(text => text === full))
})

test('valid on-device results stay local; aborts never start a server fallback', async () => {
  let fallbackCalls = 0; const updates = []
  const fallback = async () => { fallbackCalls++; return 'server' }
  assert.equal(await translateWithFallback({ translate: async () => '你好' }, 'Hello', signal(), text => updates.push(text), [], {}, fallback), '你好')
  assert.deepEqual(updates, ['你好']); assert.equal(fallbackCalls, 0)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(translateWithFallback(null, 'Hello', controller.signal, () => {}, [], {}, fallback), /abort/i)
  assert.equal(fallbackCalls, 0)
  await assert.rejects(localTranslation({ translate: async () => '' }, '', signal()), /meaning/)
})
