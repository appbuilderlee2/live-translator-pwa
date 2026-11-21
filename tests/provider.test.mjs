import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTranslateHandler } from '../shared/translate.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { networkTranslation } from '../src/network.mjs'
import { unresolvedTranslations } from '../src/recovery.mjs'

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
const request = text => new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text }) })

test('a bad translation retries before any newer captions can finish', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const order = []; let badAttempts = 0
  const segments = new Map([1, 2, 3].map(id => [id, { id, en: `caption ${id}`, timestamp: id, status: 'pending' }]))
  const queue = createTranslationQueue({ find: id => segments.get(id), online: () => true, execute: async segment => {
    if (segment.id === 1 && ++badAttempts < 3) throw Object.assign(new Error('meaning'), { code: 'translation_invalid' })
    segment.status = 'done'; order.push(segment.id)
  } })
  t.after(() => queue.dispose())
  for (const id of segments.keys()) queue.enqueue(id)
  for (let i = 0; i < 60 && order.length < 3; i++) { t.mock.timers.tick(1000); await flush() }
  assert.equal(order.length, 3); assert.equal(new Set(order).size, 3)
  assert.deepEqual(order, [1, 2, 3])
})

test('stalled successful response bodies log a typed invalid-provider failure, not a numeric DOMException code', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const original = fetch; const key = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key !== undefined) process.env.OPENAI_API_KEY = key })
  const logs = []; const handler = createTranslateHandler({ log: value => logs.push(value) })
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }))
  const pending = handler(request('Hello')); await flush(); t.mock.timers.tick(6000); await flush()
  const response = await pending
  assert.equal(response.status, 502); assert.equal((await response.json()).error, 'upstream_invalid_response')
  assert.equal(logs.length, 1); assert.equal(logs[0].status, 200); assert.equal(logs[0].latencyMs, 6000)
})

test('server cooldown doubles to 60s, globally paces healthy calls, and logs sanitized real statuses', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const original = fetch; const key = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'fixture-private-key'
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  let calls = 0; const logs = []; const delays = []
  const handler = createTranslateHandler({ log: value => logs.push(value) })
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions')
    assert.equal(options.headers.Authorization, 'Bearer fixture-private-key')
    calls++
    return new Response('fixture-private-key api_key=secret Bearer secret https://secret.example/?token=secret', { status: calls === 1 ? 500 : 429 })
  }
  for (let i = 0; i < 6; i++) {
    const response = await handler(request('Hello'))
    assert.equal(response.status, i === 0 ? 503 : 429)
    const delay = Number(response.headers.get('Retry-After')) * 1000; delays.push(delay)
    for (let client = 0; client < 10; client++) assert.equal((await handler(request('Another client'))).status, 429)
    assert.equal(calls, i + 1)
    t.mock.timers.tick(delay)
  }
  assert.deepEqual(delays, [6000, 10000, 20000, 40000, 60000, 60000])
  assert.equal(logs[0].status, 500)
  assert.equal(logs[0].provider, 'openai')
  assert.equal(logs[0].endpoint, 'https://api.openai.com/v1/chat/completions')
  assert.equal(logs[0].latencyMs, 0)
  assert.ok(!JSON.stringify(logs).includes('secret')); assert.ok(!JSON.stringify(logs).includes('fixture-private-key'))
  assert.equal(logs.length, 6)
  globalThis.fetch = async () => { calls++; return new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n') }
  assert.equal(await (await handler(request('Hello'))).text(), '你好')
  assert.equal((await handler(request('Other'))).status, 429)
  t.mock.timers.tick(5500)
  assert.equal(await (await handler(request('Hello'))).text(), '你好')
  console.log(`Server cooldown: ${delays.map(ms => ms / 1000).join(', ')}s (first includes 5.5s rate spacing); blocked clients add zero upstream calls; healthy starts >=5500ms apart`)
})

test('22-minute sustained-429 lecture deduplicates reconnect/reload/manual paths and drains oldest committed first', async t => {
  const start = 100000; const lecture = 1320000
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start })
  const original = fetch; const key = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key !== undefined) process.env.OPENAI_API_KEY = key })
  const captions = new Map(); const counts = new Map(); const order = []; const logs = []; const upstreamStarts = []
  const storage = new Map(); const persisted = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }
  let upstream = 0; let previews = 0; let active = 0; let maximum = 0; let reloaded = false; let finalRecovery = 0
  const handler = createTranslateHandler({ log: value => logs.push(value) })
  globalThis.fetch = async (url, options) => {
    if (url === '/api/translate') {
      const body = JSON.parse(options.body); if (body.preview) previews++
      counts.set(body.text, (counts.get(body.text) || 0) + 1)
      maximum = Math.max(maximum, ++active)
      try { return await handler(new Request('http://localhost/api/translate', options)) } finally { active-- }
    }
    upstream++; upstreamStarts.push(Date.now())
    if (Date.now() - start < lecture) return new Response('automated queries', { status: 429 })
    const id = new URL(url).searchParams.get('q').match(/\d+/)[0]
    return Response.json([[[`字幕 ${id}`]]])
  }
  const makeQueue = () => createTranslationQueue({ find: id => captions.get(id), online: () => true, storage: persisted, execute: async segment => {
    segment.status = 'translating'
    try {
      segment.zh = await networkTranslation(segment.en, new AbortController().signal, () => {})
      segment.status = 'done'; order.push(segment.id); finalRecovery = Date.now() - start
    } catch (error) { segment.status = 'error'; throw error }
  } })
  let queue = makeQueue(); t.after(() => queue.dispose())
  for (let id = 1; id <= 93; id++) setTimeout(() => {
    captions.set(id, { id, en: `caption ${id}`, zh: '', timestamp: Date.now(), status: 'pending' }); queue.enqueue(id)
  }, Math.floor((id - 1) * lecture / 93))
  for (let elapsed = 0; elapsed < lecture + 650000 && order.length < 93; elapsed += 500) {
    t.mock.timers.tick(500); await flush()
    if (elapsed % 5000 === 0) for (const id of captions.keys()) queue.enqueue(id)
    if (!reloaded && elapsed >= 600000) { queue.dispose(); queue = makeQueue(); for (const id of captions.keys()) queue.enqueue(id); reloaded = true }
  }
  assert.equal(order.length, 93); assert.deepEqual(order, Array.from({ length: 93 }, (_, i) => i + 1))
  assert.equal(previews, 0); assert.equal(maximum, 1)
  assert.equal(counts.get('caption 64'), 1)
  assert.ok(Math.max(...counts.values()) <= 28)
  assert.ok([...counts.values()].reduce((a, b) => a + b, 0) <= 120)
  assert.ok(upstreamStarts.slice(1).every((at, i) => at - upstreamStarts[i] >= 5500))
  assert.equal(unresolvedTranslations([...captions.keys()], [...captions.values()], []).length, 0)
  console.log(`22-min 429 lecture: 93 captions; API requests ${[...counts.values()].reduce((a, b) => a + b, 0)}; per-caption min ${Math.min(...counts.values())}, max ${Math.max(...counts.values())}; caption64 ${counts.get('caption 64')}; previews ${previews}; max in flight ${maximum}; upstream ${upstream}; throttled probes ${logs.length}; all 93 recovered oldest-first by ${finalRecovery}ms (backlog drain ${finalRecovery - lecture}ms after provider recovery)`)
})

test('queue handles empty, offline, removed and edited captions without duplicate in-flight work', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  let online = false; let release; const calls = []; const states = []
  const segments = new Map([['one', { id: 'one', en: 'original', timestamp: 1, status: 'pending' }]])
  const queue = createTranslationQueue({ find: id => segments.get(id), online: () => online, changed: state => states.push(state), execute: async segment => { calls.push(segment.en); if (calls.length === 1) await new Promise(resolve => { release = resolve }); else segment.status = 'done' } })
  t.after(() => queue.dispose())
  queue.enqueue('missing'); t.mock.timers.tick(10000); await flush(); assert.deepEqual(calls, [])
  queue.enqueue('one'); t.mock.timers.tick(10000); await flush(); assert.deepEqual(calls, [])
  online = true; queue.wake(); t.mock.timers.tick(1); await flush()
  segments.set('one', { ...segments.get('one'), en: 'revised' }); queue.enqueue('one'); queue.enqueue('one')
  release(); await flush(); t.mock.timers.tick(5500); await flush()
  assert.deepEqual(calls, ['original', 'revised'])
  assert.equal(states.at(-1).pending, 0)
})
