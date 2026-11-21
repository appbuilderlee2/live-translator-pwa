import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { coverageMismatch, localChunks, localTranslation, translateWithFallback } from '../src/local.mjs'

const recognized = 'tomorrow morning hour train leave at 9:15 we need four bottles of water and two sandwiches for the journey please help us find platform 6 thank you for speaking slowly and explaining the directions so clearly'
const truncated = '明天早上 9:15 火車出發 我們需要四瓶水和兩個三明治'
const full = '明天早上 9 點 15 分火車出發，我們需要四瓶水和兩個三明治，請幫我們找到 6 號月臺，謝謝您說得很慢，並且解釋得這麼清楚'
const signal = () => new AbortController().signal

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
