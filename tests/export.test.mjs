import { test } from 'node:test'
import assert from 'node:assert/strict'
import { waitForTranslations, formatTranscript } from '../src/export.mjs'

test('exports wait briefly and read the completed translation rather than a stale snapshot', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  let segments = [{ en: 'Hello', status: 'translating', zh: '', timestamp: 0 }]
  const result = waitForTranslations(() => segments)
  segments = [{ ...segments[0], status: 'done', zh: '你好' }]
  t.mock.timers.tick(50)
  assert.equal(formatTranscript(await result), `${new Date(0).toLocaleString()}\nHello\n你好`)
  assert.deepEqual(await waitForTranslations(() => []), [])
})

test('exports bound the wait and mark partial, interrupted and offline rows; preserve confidence and boundary warnings', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const segments = ['translating', 'error', 'pending'].map((status, i) => ({ en: `Row ${i}`, zh: i === 0 ? '部分譯文' : '', status, timestamp: 0, confidence: .6, numericWarnings: ['boundary'] }))
  const result = waitForTranslations(() => segments)
  for (let i = 0; i < 40; i++) { t.mock.timers.tick(50); await Promise.resolve() }
  const text = formatTranscript(await result, segment => segment.numericWarnings.map(() => '數字跨越收音中斷 / figures cross a recognition boundary'))
  assert.equal(text.match(/Translation still pending/g).length, 3)
  assert.equal(text.match(/Confidence: 60%/g).length, 3)
  assert.equal(text.match(/figures cross a recognition boundary/g).length, 3)
  assert.match(text, /部分譯文/)
  assert.equal(Date.now(), 3000)
  const forced = formatTranscript([{ ...segments[0], forced: true, provisional: true }])
  assert.doesNotMatch(forced, /Confidence/); assert.match(forced, /final recognition unavailable/)
  assert.equal(formatTranscript([]), '')
})
