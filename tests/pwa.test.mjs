import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { slowWorkerNavigation, registerServiceWorker, startServiceWorker } from '../src/pwa.mjs'

const slow = { workerStart: 0, fetchStart: 1.4, responseStart: 7.4, responseEnd: 90002.6, encodedBodySize: 737 }
const storage = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } }

test('recognizes the failed-start fallback timing, not only a positive workerStart', () => {
  assert.equal(slowWorkerNavigation(slow), true)
  assert.equal(slowWorkerNavigation({ workerStart: 1, fetchStart: 4002 }), true)
  for (const navigation of [undefined, {}, { ...slow, responseEnd: 20 }, { ...slow, encodedBodySize: 100000 }, { ...slow, responseStart: 0 }]) assert.equal(slowWorkerNavigation(navigation), false)
})

test('normal startup registers without blocking on serviceWorker.ready', async () => {
  const calls = []
  const serviceWorker = { register: async (...args) => calls.push(args) }
  assert.equal(await registerServiceWorker({ serviceWorker }), 'registered')
  assert.deepEqual(calls, [['/sw.js', { scope: '/', updateViaCache: 'none' }]])
  assert.equal(await registerServiceWorker({}), 'unsupported')
})

test('slow-start recovery updates then replaces the script URL at the same scope, at most once a minute', async () => {
  const calls = []; const shared = storage()
  const serviceWorker = { getRegistration: async scope => { calls.push(scope); return { update: async () => calls.push('update') } }, register: async (...args) => calls.push(args) }
  const options = { serviceWorker, storage: shared, navigation: slow, now: 100000 }
  assert.equal(await registerServiceWorker(options), 'recovered')
  assert.deepEqual(calls, ['/', 'update', ['/sw.js?recovery=100000', { scope: '/', updateViaCache: 'none' }]])
  assert.equal(await registerServiceWorker(options), 'throttled')
  assert.equal(calls.length, 3)
})

test('a hanging update or lookup cannot block recovery; failures do not reject', async () => {
  for (const lookupHangs of [false, true]) {
    let registered = false
    const serviceWorker = { getRegistration: () => lookupHangs ? new Promise(() => {}) : Promise.resolve({ update: () => new Promise(() => {}) }), register: async () => { registered = true } }
    assert.equal(await registerServiceWorker({ serviceWorker, navigation: slow, timeout: 10 }), 'recovered')
    assert.equal(registered, true)
  }
  assert.equal(await registerServiceWorker({ serviceWorker: { register: () => { throw new Error('disabled') } } }), 'failed')
  assert.equal(await registerServiceWorker({ serviceWorker: { register: () => new Promise(() => {}) }, timeout: 10 }), 'failed')
})

test('recovery tolerates denied storage and registration lookup failure', async () => {
  const serviceWorker = { getRegistration: async () => { throw new Error('lookup') }, register: async () => {} }
  assert.equal(await registerServiceWorker({ serviceWorker, navigation: slow, storage: { getItem() { throw new Error('denied') } } }), 'recovered')
})

test('registration is scheduled after load and unsupported browsers are left alone', async () => {
  let callback; let calls = 0
  const window = { document: { readyState: 'loading' }, addEventListener: (name, fn, options) => { assert.equal(name, 'load'); assert.equal(options.once, true); callback = fn } }
  const navigator = { serviceWorker: { register: async () => { calls++ } } }
  const performance = { getEntriesByType: () => [] }
  startServiceWorker({ window, navigator, performance })
  assert.equal(calls, 0); callback(); assert.equal(calls, 1)
  window.document.readyState = 'complete'; startServiceWorker({ window, navigator, performance }); assert.equal(calls, 2)
  startServiceWorker({ window, navigator: {}, performance })
  await Promise.resolve()
})

test('static navigation racing is optional and never prevents install in unsupported browsers', async () => {
  const source = await readFile(new URL('../public/sw-navigation.js', import.meta.url), 'utf8')
  let install; let route; let waited
  vm.runInNewContext(source, { self: { addEventListener: (name, fn) => { assert.equal(name, 'install'); install = fn } } })
  install({})
  install({ addRoutes: value => { route = value; return Promise.resolve() }, waitUntil: promise => { waited = promise } }); await waited
  assert.equal(route.condition.requestMode, 'navigate')
  assert.equal(route.source, 'race-network-and-fetch-handler')
  install({ addRoutes: () => Promise.reject(new Error('unsupported source')), waitUntil: promise => { waited = promise } }); await waited
  install({ addRoutes() { throw new Error('unsupported') } })
})
