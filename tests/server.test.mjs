import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServer } from '../server.mjs'

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'translator-server-'))
  await Promise.all(['index.html', 'sw.js', 'registerSW.js'].map(file => writeFile(join(directory, file), file === 'index.html' ? '台灣字幕' : '// worker')))
  const server = createAppServer({ directory, ...options })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true }) })
  return `http://127.0.0.1:${server.address().port}`
}

test('static GET and HEAD have exact byte lengths and preserve reload cache headers', async t => {
  const url = await fixture(t)
  for (const path of ['/', '/index.html', '/sw.js', '/registerSW.js', '/old-route']) {
    const get = await fetch(url + path)
    const body = await get.arrayBuffer()
    assert.equal(get.status, 200)
    assert.equal(Number(get.headers.get('content-length')), body.byteLength)
    assert.equal(get.headers.get('transfer-encoding'), null)
    assert.equal(get.headers.get('cache-control'), path.endsWith('.js') ? 'no-cache' : 'no-store')
    const head = await fetch(url + path, { method: 'HEAD' })
    assert.equal(head.headers.get('content-length'), get.headers.get('content-length'))
    assert.equal(await head.text(), '')
  }
  assert.equal((await fetch(url, { method: 'POST' })).status, 405)
  assert.equal((await fetch(url + '/api/translate')).status, 405)
})

test('a paused incoming POST body times out and closes without blocking navigation', async t => {
  let calls = 0
  const url = await fixture(t, { timeout: 80, translate: async () => { calls++; return new Response('unexpected') } })
  const response = new Promise((resolve, reject) => {
    const request = http.request(url + '/api/translate', { method: 'POST', headers: { 'Content-Length': '1000' } }, resolve)
    request.on('error', reject)
    request.write('{')
  })
  assert.equal((await fetch(url)).status, 200)
  const result = await response
  let body = ''; for await (const chunk of result) body += chunk
  assert.equal(result.statusCode, 503)
  assert.equal(JSON.parse(body).error, 'translation_timeout')
  assert.equal(result.headers.connection, 'close')
  assert.equal(result.headers['retry-after'], '5')
  assert.equal(calls, 0)
})

test('a handler that never returns headers is bounded and aborted', async t => {
  let signal
  const url = await fixture(t, { timeout: 80, translate: request => { signal = request.signal; return new Promise(() => {}) } })
  const response = await fetch(url + '/api/translate', { method: 'POST', body: '{}' })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'translation_timeout' })
  assert.equal(signal.aborted, true)
})

test('a non-ending response stream is cut off and its source cancelled', async t => {
  let cancelled = false
  const url = await fixture(t, { timeout: 80, translate: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('partial translation')) }, cancel() { cancelled = true } })) })
  const response = await fetch(url + '/api/translate', { method: 'POST', body: '{}' })
  assert.equal(response.status, 200)
  await assert.rejects(response.text())
  assert.equal(cancelled, true)
  assert.equal((await fetch(url)).status, 200)
})

test('healthy translation responses finish normally and empty bodies terminate', async t => {
  const url = await fixture(t, { timeout: 1000, translate: async request => {
    const { text } = await request.json()
    return text ? new Response('翻譯完成') : new Response(null, { status: 204 })
  } })
  const response = await fetch(url + '/api/translate', { method: 'POST', body: JSON.stringify({ text: 'Hello' }) })
  assert.equal(await response.text(), '翻譯完成')
  const empty = await fetch(url + '/api/translate', { method: 'POST', body: '{}' })
  assert.equal(empty.status, 204)
  assert.equal(await empty.text(), '')
})
