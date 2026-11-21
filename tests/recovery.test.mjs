import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTranslationRecovery, unresolvedTranslations } from '../src/recovery.mjs'
import { createLimiter, createRateLimiter, withTimeout } from '../shared/retry.mjs'
import { translateHandler } from '../shared/translate.mjs'
import { networkTranslation } from '../src/network.mjs'

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
const request = (text, preview = false) => new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text, preview }) })

test('interrupted translations retry automatically with backoff, keep latest text, and stop after success', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let segment = { id: 'x', en: 'original', status: 'error' }
  const calls = []
  const recovery = createTranslationRecovery({ find: () => segment, retry: s => calls.push(s.en), online: () => true })
  t.after(() => recovery.dispose())
  recovery.failed('x'); recovery.failed('x')
  t.mock.timers.tick(999); assert.deepEqual(calls, [])
  segment.en = 'revised'; t.mock.timers.tick(1); assert.deepEqual(calls, ['revised'])
  recovery.begin('x'); recovery.failed('x')
  t.mock.timers.tick(1999); assert.equal(calls.length, 1)
  t.mock.timers.tick(1); assert.equal(calls.length, 2)
  recovery.failed('x'); recovery.succeeded('x')
  t.mock.timers.tick(60000); assert.equal(calls.length, 2)
})

test('removed, offline or already translating segments do not retry; disposal cancels timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let segment; let online = true; let count = 0
  const recovery = createTranslationRecovery({ find: () => segment, retry: () => count++, online: () => online })
  recovery.failed('gone'); t.mock.timers.tick(1000); assert.equal(count, 0)
  segment = { status: 'error' }; online = false
  recovery.failed('offline'); t.mock.timers.tick(1000); assert.equal(count, 0)
  online = true; recovery.failed('offline'); t.mock.timers.tick(2000); assert.equal(count, 1)
  segment.status = 'translating'; recovery.failed('busy'); t.mock.timers.tick(1000); assert.equal(count, 1)
  recovery.failed('disposed'); recovery.dispose(); t.mock.timers.tick(60000); assert.equal(count, 1)
})

test('repeated failures retry within three seconds even after many attempts', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const recovery = createTranslationRecovery({ find: () => ({ status: 'error' }), online: () => true, retry: () => calls++ })
  t.after(() => recovery.dispose())
  for (let attempt = 0; attempt < 12; attempt++) {
    recovery.begin('x'); recovery.failed('x')
    const delay = Math.min(1000 * 2 ** attempt, 3000)
    t.mock.timers.tick(delay - 1); assert.equal(calls, attempt)
    t.mock.timers.tick(1); assert.equal(calls, attempt + 1)
  }
})

test('recovered or removed caption notices disappear while other failed/in-flight captions remain', () => {
  const current = [{ id: 'done', status: 'done' }, { id: 'retrying', status: 'translating' }]
  const history = [{ segments: [{ id: 'failed', status: 'error' }, { id: 'saved', status: 'done' }] }]
  assert.deepEqual(unresolvedTranslations(['done', 'retrying', 'failed', 'saved', 'removed'], current, history), ['retrying', 'failed'])
  assert.deepEqual(unresolvedTranslations(['done', 'saved'], current, history), [])
  assert.deepEqual(unresolvedTranslations([], [], []), [])
})

test('limiter removes aborted queued previews and prioritizes committed captions', async () => {
  const limit = createLimiter(1); const calls = []; let release
  const blocker = limit(() => new Promise(resolve => { release = resolve }))
  await flush()
  const preview = limit(() => calls.push('preview'), { priority: -1 })
  const controller = new AbortController()
  const cancelled = assert.rejects(limit(() => calls.push('cancelled'), { signal: controller.signal }), /abort/i)
  const committed = limit(() => calls.push('committed'))
  controller.abort(); release()
  await Promise.all([blocker, preview, cancelled, committed])
  assert.deepEqual(calls, ['committed', 'preview'])
})

test('timeouts and cancellation interrupt stalled operations, including queued or streaming work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let operationSignal
  const stalled = assert.rejects(withTimeout(signal => { operationSignal = signal; return new Promise(() => {}) }, { timeout: 1000 }), /timed out/)
  t.mock.timers.tick(1000); await stalled; assert.equal(operationSignal.aborted, true)
  const controller = new AbortController()
  const cancelled = assert.rejects(withTimeout(() => new Promise(() => {}), { signal: controller.signal }), /abort/i)
  controller.abort(); await cancelled
  assert.equal(await withTimeout(async () => 'healthy'), 'healthy')
})

test('four simultaneous initial provider failures retry without occupying limiter slots during backoff', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const original = fetch; const key = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key !== undefined) process.env.OPENAI_API_KEY = key })
  const attempts = new Map()
  globalThis.fetch = async url => {
    const text = new URL(url).searchParams.get('q'); const count = (attempts.get(text) || 0) + 1; attempts.set(text, count)
    return count === 1 ? new Response('Unavailable', { status: 503 }) : Response.json([[['完成']]])
  }
  const requests = ['walking', 'clinic', 'daughter', 'review'].map(text => translateHandler(request(text)))
  await flush()
  for (let i = 0; i < 20; i++) { t.mock.timers.tick(150); await flush() }
  for (const response of await Promise.all(requests)) { assert.equal(response.status, 200); assert.equal(await response.text(), '完成') }
  assert.deepEqual([...attempts.values()], [2, 2, 2, 2])
})

test('a stalled preview response body times out and releases capacity for the next caption', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const original = fetch; const key = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key !== undefined) process.env.OPENAI_API_KEY = key })
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }))
  const stalled = translateHandler(request('stalled preview', true))
  await flush(); t.mock.timers.tick(1200); await flush()
  assert.equal((await stalled).status, 502)
  globalThis.fetch = async () => Response.json([[['已恢復']]])
  const healthy = translateHandler(request('healthy preview', true))
  await flush(); t.mock.timers.tick(150); await flush()
  assert.equal(await (await healthy).text(), '已恢復')
})

test('upstream starts are paced, and cancelled queued work never calls a provider', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const paced = createRateLimiter(150); const calls = []
  const first = paced(() => calls.push(Date.now()))
  const controller = new AbortController()
  const cancelled = assert.rejects(paced(() => calls.push('cancelled'), { signal: controller.signal }), /abort/i)
  const second = paced(() => calls.push(Date.now()))
  await flush(); controller.abort(); await flush()
  t.mock.timers.tick(149); await flush(); assert.deepEqual(calls, [1000])
  t.mock.timers.tick(1); await flush(); await Promise.all([first, second, cancelled])
  assert.deepEqual(calls, [1000, 1150])
})

test('100 captions recover during a sustained 50% HTTP 502 storm without manual retry', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() })
  const original = fetch; const key = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key !== undefined) process.env.OPENAI_API_KEY = key })
  const segments = new Map(); const attempts = new Map(); const hosts = new Set(); const recovered = []
  let responses = 0; let failures = 0
  globalThis.fetch = async (url, options) => {
    if (url === '/api/translate') {
      const response = await translateHandler(new Request('http://localhost/api/translate', options))
      responses++; if (response.status === 502) failures++
      return response
    }
    const target = new URL(url); hosts.add(target.host)
    const id = Number(target.searchParams.get('q').match(/\d+/)[0])
    const count = (attempts.get(id) || 0) + 1; attempts.set(id, count)
    return id % 4 === 0 && count <= 8 ? new Response('Unavailable', { status: 502 }) : Response.json([[[`字幕 ${id}`]]])
  }
  const run = async segment => {
    recovery.begin(segment.id); segment.status = 'translating'
    try {
      segment.zh = await networkTranslation(segment.en, new AbortController().signal, () => {})
      segment.status = 'done'; recovery.succeeded(segment.id); recovered.push(Date.now() - segment.started)
    } catch { segment.status = 'error'; recovery.failed(segment.id) }
  }
  const recovery = createTranslationRecovery({ find: id => segments.get(id), retry: run, online: () => true })
  t.after(() => recovery.dispose())
  for (let id = 0; id < 100; id++) setTimeout(() => {
    const segment = { id, en: `caption ${id}`, status: 'pending', started: Date.now() }; segments.set(id, segment); void run(segment)
  }, id * 1000)
  for (let elapsed = 0; elapsed < 120000 && recovered.length < 100; elapsed += 50) { t.mock.timers.tick(50); await flush() }
  assert.equal(recovered.length, 100)
  assert.equal(failures, 100); assert.equal(responses, 200)
  assert.deepEqual([...hosts].sort(), ['translate.google.com', 'translate.googleapis.com'])
  const maximum = Math.max(...recovered)
  assert.ok(maximum <= 8000, `Max recovery ${maximum}ms`)
  console.log(`502 storm: 100 captions at 1/s; ${failures}/${responses} API responses HTTP 502; all 100 recovered automatically; max recovery ${maximum}ms`)
})
