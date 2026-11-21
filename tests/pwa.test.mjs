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
  assert.equal(slowWorkerNavigation({ ...slow, workerMatchedSourceType: 'race-network-and-fetch-handler' }), false)
  assert.equal(slowWorkerNavigation({ ...slow, responseEnd: 20000 }), false)
  for (const navigation of [undefined, {}, { ...slow, responseEnd: 20 }, { ...slow, encodedBodySize: 100000 }, { ...slow, responseStart: 0 }]) assert.equal(slowWorkerNavigation(navigation), false)
})

test('normal startup registers without blocking on serviceWorker.ready', async () => {
  const calls = []
  const serviceWorker = { register: async (...args) => calls.push(args) }
  assert.equal(await registerServiceWorker({ serviceWorker }), 'registered')
  assert.deepEqual(calls, [['/sw.js', { scope: '/', updateViaCache: 'none' }]])
  assert.equal(await registerServiceWorker({}), 'unsupported')
})

test('slow-start recovery uses one stable URL and makes at most one persisted attempt per build', async () => {
  const calls = []; const shared = storage()
  const serviceWorker = { getRegistration: async scope => { calls.push(scope); return { update: async () => calls.push('update') } }, register: async (...args) => calls.push(args) }
  const options = { serviceWorker, storage: shared, navigation: slow, build: 'build-123' }
  assert.equal(await registerServiceWorker(options), 'recovered')
  assert.deepEqual(calls, [['/sw.js?recovery=build-123', { scope: '/', updateViaCache: 'none' }]])
  assert.equal(await registerServiceWorker(options), 'throttled')
  assert.equal(calls.length, 1)
  assert.equal(await registerServiceWorker({ ...options, build: 'build-456' }), 'recovered')
})

test('a hanging update or lookup cannot block recovery; failures do not reject', async () => {
  for (const lookupHangs of [false, true]) {
    let registered = false
    const serviceWorker = { getRegistration: () => lookupHangs ? new Promise(() => {}) : Promise.resolve({ update: () => new Promise(() => {}) }), register: async () => { registered = true } }
    assert.equal(await registerServiceWorker({ serviceWorker, navigation: slow, storage: storage(), timeout: 10 }), 'recovered')
    assert.equal(registered, true)
  }
  assert.equal(await registerServiceWorker({ serviceWorker: { register: () => { throw new Error('disabled') } } }), 'failed')
  assert.equal(await registerServiceWorker({ serviceWorker: { register: () => new Promise(() => {}) }, timeout: 10 }), 'failed')
})

test('recovery refuses unpersisted attempts when storage is denied', async () => {
  const serviceWorker = { getRegistration: async () => { throw new Error('lookup') }, register: async () => {} }
  assert.equal(await registerServiceWorker({ serviceWorker, navigation: slow, storage: { getItem() { throw new Error('denied') } } }), 'failed')
  assert.equal(await registerServiceWorker({ serviceWorker, navigation: slow }), 'failed')
})

test('five healthy loads preserve an existing recovery registration without registering or updating', async () => {
  let installs = 0
  const serviceWorker = { getRegistration: async () => ({ active: { scriptURL: '/sw.js?recovery=old-timestamp' }, update() { installs++ } }), register() { installs++ } }
  for (let i = 0; i < 5; i++) assert.equal(await registerServiceWorker({ serviceWorker, navigation: { workerStart: 1, fetchStart: 2 } }), 'existing')
  assert.equal(installs, 0)
})

test('a hanging recovery is capped before registration, including across page instances', async () => {
  const shared = storage(); let calls = 0
  const serviceWorker = { register() { calls++; return new Promise(() => {}) } }
  const options = { serviceWorker, navigation: slow, storage: shared, timeout: 10, build: 'stuck-build' }
  assert.equal(await registerServiceWorker(options), 'failed')
  assert.equal(await registerServiceWorker({ ...options, serviceWorker: { ...serviceWorker } }), 'throttled')
  assert.equal(calls, 1)
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
