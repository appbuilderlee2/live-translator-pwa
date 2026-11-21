import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retry, retryAfter } from '../shared/retry.mjs'
import { translateHandler } from '../shared/translate.mjs'
import { networkTranslation } from '../src/network.mjs'

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }

test('Retry-After parses seconds and HTTP dates, ignores missing/invalid values, and caps at three seconds', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(retryAfter('2', now), 2000)
  assert.equal(retryAfter('Thu, 01 Jan 2026 00:00:02 GMT', now), 2000)
  assert.equal(retryAfter('Wed, 31 Dec 2025 23:59:59 GMT', now), 0)
  for (const value of ['999999', 'Thu, 01 Jan 2026 01:00:00 GMT']) assert.equal(retryAfter(value, now), 3000)
  for (const value of [null, undefined, '', 'invalid']) assert.equal(retryAfter(value, now), undefined)
})

test('retry honors capped provider delays, keeps ordinary backoff and cancels without another attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const pending = retry(async () => { if (++calls === 1) throw Object.assign(new Error('429'), { retryAfter: 100000 }); return 'ok' })
  await flush(); t.mock.timers.tick(2999); await flush(); assert.equal(calls, 1)
  t.mock.timers.tick(1); assert.equal(await pending, 'ok')
  const controller = new AbortController()
  const cancelled = retry(async () => { throw Object.assign(new Error('429'), { retryAfter: 3000 }) }, { signal: controller.signal })
  const rejected = assert.rejects(cancelled, /abort/i)
  await flush(); controller.abort(); await rejected
  calls = 0
  const ordinary = retry(async () => { if (++calls === 1) throw new Error('network'); return 'ok' }, { delay: 180 })
  await flush(); t.mock.timers.tick(179); await flush(); assert.equal(calls, 1)
  t.mock.timers.tick(1); assert.equal(await ordinary, 'ok')
})

test('Google 429 waits then uses the configured alternate endpoint; exhausted previews retain capped Retry-After', async t => {
  const original = fetch
  const env = { ...process.env }
  t.after(() => {
    globalThis.fetch = original
    for (const key of ['OPENAI_API_KEY', 'GOOGLE_TRANSLATE_URL', 'GOOGLE_TRANSLATE_FALLBACK_URL']) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]
    }
  })
  delete process.env.OPENAI_API_KEY
  process.env.GOOGLE_TRANSLATE_URL = 'https://primary.example/translate'
  process.env.GOOGLE_TRANSLATE_FALLBACK_URL = 'https://alternate.example/translate'
  const calls = []
  globalThis.fetch = async url => {
    calls.push({ url, time: Date.now() })
    return calls.length === 1 ? new Response('limited', { status: 429, headers: { 'Retry-After': '0.2' } }) : Response.json([[['你好']]])
  }
  const request = preview => new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text: 'Hello', preview }) })
  assert.equal(await (await translateHandler(request(false))).text(), '你好')
  assert.deepEqual(calls.map(call => new URL(call.url).host), ['primary.example', 'alternate.example'])
  assert.ok(calls[1].time - calls[0].time >= 190)
  globalThis.fetch = async () => new Response('limited', { status: 429, headers: { 'Retry-After': '999' } })
  const exhausted = await translateHandler(request(true))
  assert.equal(exhausted.status, 429)
  assert.equal(exhausted.headers.get('Retry-After'), '3')
})

test('browser network retries respect the API Retry-After header', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const original = fetch; t.after(() => { globalThis.fetch = original })
  let calls = 0
  globalThis.fetch = async () => ++calls === 1 ? new Response('limited', { status: 429, headers: { 'Retry-After': '2' } }) : new Response('你好')
  const pending = networkTranslation('Hello', new AbortController().signal, () => {})
  await flush(); t.mock.timers.tick(1999); await flush(); assert.equal(calls, 1)
  t.mock.timers.tick(1); assert.equal(await pending, '你好')
})
