import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDeviceTranslator } from '../src/device.mjs'
import { translateWithFallback } from '../src/local.mjs'

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('unsupported and unavailable devices remain on the existing network fallback', async () => {
  for (const api of [undefined, { availability: async () => 'unavailable', create() { assert.fail('unavailable model must not be created') } }]) {
    const device = createDeviceTranslator(api)
    assert.equal(await device.probe(), 'unavailable')
    assert.equal(await device.prepare(), null)
    assert.equal(device.current(), null)
    let calls = 0
    assert.equal(await translateWithFallback(device.current(), 'Hello', new AbortController().signal, () => {}, [], {}, async () => { calls++; return '你好' }), '你好')
    assert.equal(calls, 1)
  }
})

test('availability probes do not download; one gesture starts a persistent download while fallback remains usable', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const download = deferred(); const snapshots = []; let progress; let creates = 0; let probes = 0
  const translator = { translate: async () => '你好' }
  const device = createDeviceTranslator({
    async availability(options) { probes++; assert.deepEqual(options, { sourceLanguage: 'en', targetLanguage: 'zh-Hant' }); return 'downloadable' },
    create(options) { creates++; options.monitor({ addEventListener(name, listener) { assert.equal(name, 'downloadprogress'); progress = listener } }); return download.promise }
  })
  const unsubscribe = device.subscribe(state => snapshots.push(state))
  assert.equal(await device.probe(), 'downloadable')
  assert.equal(creates, 0)
  const preparation = device.prepare()
  assert.equal(creates, 1)
  const repeated = device.prepare()
  progress({ loaded: .42 })
  assert.deepEqual(snapshots.at(-1), { status: 'downloading', progress: 42 })
  t.mock.timers.tick(20000)
  assert.equal(device.current(), null)
  assert.equal(await translateWithFallback(device.current(), 'Hello', new AbortController().signal, () => {}, [], {}, async () => '線上翻譯'), '線上翻譯')
  progress({ loaded: 1 })
  assert.deepEqual(snapshots.at(-1), { status: 'preparing', progress: 100 })
  download.resolve(translator)
  assert.equal(await preparation, translator)
  assert.equal(await repeated, translator)
  assert.equal(await device.prepare(), translator)
  assert.equal(device.current(), translator)
  assert.equal(await translateWithFallback(device.current(), 'Hello', new AbortController().signal, () => {}, [], {}, async () => { assert.fail('ready translator must be used') }), '你好')
  assert.deepEqual(snapshots.at(-1), { status: 'ready', progress: 100 })
  progress({ loaded: .5 })
  assert.deepEqual(snapshots.at(-1), { status: 'ready', progress: 100 })
  assert.equal(creates, 1); assert.equal(probes, 1)
  unsubscribe()
})

test('already downloaded models initialize early and remain reusable after slow creation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const creation = deferred(); const translator = { translate() {} }; let creates = 0
  const device = createDeviceTranslator({ availability: async () => 'available', create() { creates++; return creation.promise } })
  await device.probe()
  assert.equal(creates, 1)
  t.mock.timers.tick(5000)
  assert.equal(device.current(), null)
  creation.resolve(translator)
  assert.equal(await device.prepare(), translator)
  assert.equal(device.current(), translator)
  assert.equal(creates, 1)
})

test('concurrent gestures during availability checking share one creation', async () => {
  const availability = deferred(); const translator = { translate() {} }; let creates = 0
  const device = createDeviceTranslator({ availability: () => availability.promise, create() { creates++; return Promise.resolve(translator) } })
  const first = device.prepare(); const second = device.prepare()
  availability.resolve('downloadable')
  assert.deepEqual(await Promise.all([first, second]), [translator, translator])
  assert.equal(creates, 1)
})

test('creation failures are retryable on the next gesture without a poisoned cache', async () => {
  for (const synchronous of [false, true]) {
    let creates = 0; const snapshots = []; const translator = { translate() {} }
    const device = createDeviceTranslator({ availability: async () => 'downloadable', create() {
      if (++creates === 1) { if (synchronous) throw new Error('Activation required'); return Promise.reject(new Error('Download failed')) }
      return Promise.resolve(translator)
    } })
    device.subscribe(state => snapshots.push(state))
    await device.probe()
    assert.equal(await device.prepare(), null)
    assert.equal(snapshots.at(-1).status, 'error')
    assert.equal(device.current(), null)
    assert.equal(await device.prepare(), translator)
    assert.equal(creates, 2)
  }
})

test('availability errors can recover and unsubscribed listeners stop receiving state', async () => {
  let probes = 0; const snapshots = []
  const device = createDeviceTranslator({ availability() { if (++probes === 1) throw new Error('Policy unavailable'); return 'downloadable' }, create: async () => ({ translate() {} }) })
  const unsubscribe = device.subscribe(state => snapshots.push(state))
  assert.equal(await device.probe(), 'unavailable')
  assert.equal(snapshots.at(-1).status, 'error')
  unsubscribe(); const count = snapshots.length
  assert.ok(await device.prepare())
  assert.equal(snapshots.length, count)
})
