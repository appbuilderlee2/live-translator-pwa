import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translateHandler } from '../shared/translate.mjs'
const request = text => new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text }) })
test('rejects empty, malformed and oversized input', async () => {
  for (const value of ['', ' ', null, 42, 'a'.repeat(2001)]) assert.equal((await translateHandler(request(value))).status, 400)
  assert.equal((await translateHandler(new Request('http://localhost', { method: 'POST', body: '{' }))).status, 400)
  assert.equal((await translateHandler(new Request('http://localhost'))).status, 405)
})
test('Google joins translated chunks and returns 502 for errors', async () => {
  const original = globalThis.fetch; const key = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY
  try {
    globalThis.fetch = async () => Response.json([[['你好', 'Hello'], ['，世界', 'world']]])
    assert.equal(await (await translateHandler(request('Hello world'))).text(), '你好，世界')
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 })
    assert.equal((await translateHandler(request('Hello'))).status, 502)
    globalThis.fetch = async () => { throw new Error('network') }
    assert.equal((await translateHandler(request('Hello'))).status, 502)
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key }
})
test('OpenAI SSE handles split chunks and streams only text', async () => {
  const original = globalThis.fetch; const key = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test'
  try {
    const data = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"delta":{"content":"！"}}]}\n\ndata: [DONE]\n\n'
    globalThis.fetch = async (_url, options) => { assert.equal(JSON.parse(options.body).stream, true); const bytes = new TextEncoder().encode(data); return new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 43)); c.enqueue(bytes.slice(43, 47)); c.enqueue(bytes.slice(47)); c.close() } })) }
    const response = await translateHandler(request('Hello')); assert.equal(response.status, 200); assert.equal(await response.text(), '你好！')
    globalThis.fetch = async () => new Response('', { status: 401 }); assert.equal((await translateHandler(request('Hello'))).status, 502)
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key }
})
