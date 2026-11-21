import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retry, retryAfter } from '../shared/retry.mjs'
import { createTranslateHandler } from '../shared/translate.mjs'
import { networkTranslation } from '../src/network.mjs'

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }

test('Retry-After parses seconds and HTTP dates, with explicit long provider cooldown support', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(retryAfter('2', now), 2000)
  assert.equal(retryAfter('Thu, 01 Jan 2026 00:00:02 GMT', now), 2000)
  assert.equal(retryAfter('Wed, 31 Dec 2025 23:59:59 GMT', now), 0)
  assert.equal(retryAfter('999999', now), 3000)
  assert.equal(retryAfter('120', now, 86400000), 120000)
  for (const value of [null, undefined, '', 'invalid']) assert.equal(retryAfter(value, now), undefined)
})

test('generic retry remains bounded and cancellable for non-translation callers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const pending = retry(async () => { if (++calls === 1) throw Object.assign(new Error('429'), { retryAfter: 100000 }); return 'ok' })
  await flush(); t.mock.timers.tick(2999); await flush(); assert.equal(calls, 1)
  t.mock.timers.tick(1); assert.equal(await pending, 'ok')
  const controller = new AbortController()
  const cancelled = retry(async () => { throw Object.assign(new Error('429'), { retryAfter: 3000 }) }, { signal: controller.signal })
  const rejected = assert.rejects(cancelled, /abort/i)
  await flush(); controller.abort(); await rejected
})

test('Google 429 fails once, all clients share the cooldown, next probe uses configured alternate', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const original = fetch; const env = { ...process.env }
  t.after(() => { globalThis.fetch = original; for (const key of ['OPENAI_API_KEY', 'GOOGLE_TRANSLATE_URL', 'GOOGLE_TRANSLATE_FALLBACK_URL']) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key] } })
  delete process.env.OPENAI_API_KEY
  process.env.GOOGLE_TRANSLATE_URL = 'https://primary.example/translate'
  process.env.GOOGLE_TRANSLATE_FALLBACK_URL = 'https://alternate.example/translate'
  const calls = []; const logs = []
  const handler = createTranslateHandler({ log: log => logs.push(log) })
  globalThis.fetch = async url => { calls.push(new URL(url).host); return calls.length === 1 ? new Response('limited', { status: 429, headers: { 'Retry-After': '120' } }) : Response.json([[['你好']]]) }
  const request = (preview = false) => new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text: 'Hello', preview }) })
  const first = await handler(request())
  assert.equal(first.status, 429); assert.equal(first.headers.get('Retry-After'), '120')
  assert.equal((await first.json()).error, 'upstream_rate_limited')
  for (let i = 0; i < 20; i++) { const blocked = await handler(request()); assert.equal(blocked.status, 429); assert.equal((await blocked.json()).error, 'provider_cooldown') }
  assert.equal((await handler(request(true))).status, 409)
  t.mock.timers.tick(119999); assert.equal((await handler(request())).status, 429)
  assert.equal(calls.length, 1)
  t.mock.timers.tick(1)
  assert.equal(await (await handler(request())).text(), '你好')
  assert.deepEqual(calls, ['primary.example', 'alternate.example'])
  assert.equal(logs.length, 1); assert.equal(logs[0].status, 429); assert.equal(logs[0].snippet, 'limited')
})

test('browser exposes API cooldown to the queue without its own retries, and never sends previews', async t => {
  const original = fetch; t.after(() => { globalThis.fetch = original })
  let calls = 0
  globalThis.fetch = async () => { calls++; return Response.json({ error: 'provider_cooldown' }, { status: 429, headers: { 'Retry-After': '120' } }) }
  await assert.rejects(networkTranslation('Hello', new AbortController().signal, () => {}), error => error.retryAfter === 120000 && error.code === 'provider_cooldown')
  await assert.rejects(networkTranslation('interim', new AbortController().signal, () => {}, [], { preview: true }), /previews disabled/)
  assert.equal(calls, 1)
})
