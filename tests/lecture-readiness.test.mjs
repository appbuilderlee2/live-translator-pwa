import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { readableChinese } from '../shared/phrasing.mjs'

for (const resume of ['onaudiostart', 'onresult']) test(`recognition start is not audio readiness; ${resume} clears reconnecting immediately`, t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const rec = { starts: 0, start() { this.starts++ }, stop() {} }
  let state; let message; let commits = 0
  const speech = createSpeechController(rec, { state(value) { state = value }, message(value) { message = value }, preview() {}, commit() { return ++commits } })
  t.after(() => speech.dispose())
  speech.start(); rec.onstart(); assert.equal(state, 'requesting')
  rec.onaudiostart(); assert.equal(state, 'listening')
  for (let error = 0; error < 3; error++) {
    rec.onerror({ error: 'network' }); t.mock.timers.tick(3); rec.onend()
    assert.equal(state, 'retrying')
    t.mock.timers.tick(58); rec.onstart()
    assert.equal(state, 'retrying'); assert.ok(message)
    t.mock.timers.tick(3156); assert.equal(state, 'retrying')
    t.mock.timers.tick(1)
    rec[resume](resume === 'onresult' ? { results: [Object.assign([{ transcript: 'Recognition has resumed.', confidence: .9 }], { isFinal: false })] } : undefined)
    assert.equal(state, 'listening'); assert.equal(message, '')
    if (resume === 'onaudiostart') rec.onresult({ results: [Object.assign([{ transcript: 'Recognition has resumed.', confidence: .9 }], { isFinal: false })] })
  }
  assert.equal(rec.starts, 4)
  const starts = rec.starts; t.mock.timers.tick(10000); assert.equal(rec.starts, starts)
  speech.stop(); rec.onaudiostart(); rec.onstart(); assert.equal(state, 'idle')
})

test('empty result events cannot mark a reconnecting microphone ready', t => {
  const rec = { start() {}, stop() {} }; let state
  const speech = createSpeechController(rec, { state(value) { state = value }, message() {}, preview() {}, commit() {} })
  t.after(() => speech.dispose())
  speech.start(); rec.onerror({ error: 'network' }); rec.onend(); rec.onstart(); rec.onresult({ results: [] })
  assert.equal(state, 'retrying')
})

test('science lecture clauses get punctuation without changing any translated words', () => {
  const source = 'section 8 today we are discussing scientific experiments a scientific experiment begins with a clear question we change one factor and keep the other'
  const chinese = '第8節今天我們討論科學實驗科學實驗從一個明確的問題開始我們改變一個因素並保留另一個因素'
  const expected = '第8節。今天我們討論科學實驗。科學實驗從一個明確的問題開始。我們改變一個因素並保留另一個因素。'
  assert.equal(readableChinese(source, chinese), expected)
  assert.equal(readableChinese(source, expected), expected)
  assert.equal(readableChinese(source, chinese, false), expected.slice(0, -1))
  assert.equal(readableChinese(source, ''), '')
  assert.equal(readableChinese('A different long lecture without these clause cues contains many words about the school and its students and their projects and their plans for tomorrow morning.', chinese), `${chinese}。`)
  assert.equal(readableChinese(source, chinese).replace(/[。]/g, ''), chinese)
})
