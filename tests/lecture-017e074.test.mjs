import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { readableChinese } from '../shared/phrasing.mjs'

const experiment = 'action 4 today we are discussing scientific experiment a scientific experiment begins with a clear question we change one factor and keep the other conditions the same recording result carefully makes the experiment easier to repeat a surprising result is not a failure it is a reason to ask a better question this is the end of action for'
const terminal = 'it is not a failure it is a reason to ask a better question this is the end of section for the'
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }

test('lecture caption 09 separates section ending and solar-energy topic clauses without source punctuation', () => {
  const source = 'failure it is a reason to ask a better question this is the end of action for Action five today we are discussing solar energy solar panels convert sunlight into electricity a school can place panels on its roof'
  const raw = '失敗是提出更好問題的理由這是今天行動時間的行動結束我們正在討論太陽能太陽能電池板將陽光轉化為電能學校可以在其上放置電池板。'
  const expected = '失敗是提出更好問題的理由。這是今天行動時間的行動結束。我們正在討論太陽能。太陽能電池板將陽光轉化為電能。學校可以在其上放置電池板。'
  assert.equal(readableChinese(source, raw), expected)
  assert.equal(readableChinese(source, expected), expected)
  assert.equal(readableChinese(source, ''), '')
  assert.equal(readableChinese('We hope that a school can help students understand this complex subject and explain all of the important principles in greater detail to everyone attending today', '我們希望學校可以幫助學生理解這個主題。'), '我們希望學校可以幫助學生理解這個主題。')
})

for (const ordering of ['final-end', 'end-final', 'error-end-final']) test(`lecture finals drain exactly once across ${ordering}, including artificial dangling chunk ends`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const captions = new Map(); const calls = []; let id = 0
  const queue = createTranslationQueue({ find: key => captions.get(key), online: () => true, execute: async segment => {
    calls.push(segment.id); segment.status = 'done'
  } })
  const rec = { start() {}, stop() {} }
  const controller = createSpeechController(rec, {
    commit(en, metadata) { const key = ++id; captions.set(key, { id: key, en, timestamp: id, status: 'pending', ...metadata }); queue.enqueue(key); return key },
    revise(key, en, metadata) { Object.assign(captions.get(key), { en, ...metadata }); queue.enqueue(key) },
    preview() {}, state() {}, message() {}
  })
  t.after(() => { controller.dispose(); queue.dispose() })
  const emit = (text, final) => rec.onresult({ results: [Object.assign([{ transcript: text, confidence: .97 }], { isFinal: final })] })
  controller.start()
  emit(experiment.split(' ').slice(0, 45).join(' '), false)
  t.mock.timers.tick(1200)
  assert.equal(calls.length, 0)
  if (ordering.startsWith('error')) rec.onerror({ error: 'network' })
  if (ordering !== 'final-end') rec.onend()
  emit(experiment, true)
  if (ordering === 'final-end') rec.onend()
  t.mock.timers.tick(300)
  emit(terminal, true)
  controller.stop(); rec.onend()
  for (let i = 0; i < 25; i++) { t.mock.timers.tick(2500); await flush() }
  assert.ok(captions.size > 2)
  assert.ok([...captions.values()].every(segment => segment.status === 'done'))
  assert.equal(calls.length, captions.size)
  assert.equal(new Set(calls).size, captions.size)
  assert.equal([...captions.values()].map(segment => segment.en).join(' '), `${experiment} ${terminal}`)
  console.log(`${ordering}: ${captions.size} final captions; ${calls.length} requests; 0 pending; 0 duplicate requests`)
})

test('ending an empty recognition session does not create translation work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let commits = 0
  const rec = { start() {}, stop() {} }
  const controller = createSpeechController(rec, { commit() { commits++ }, preview() {}, state() {}, message() {} })
  controller.start(); controller.stop(); rec.onend(); await controller.finish()
  t.mock.timers.tick(10000); controller.dispose()
  assert.equal(commits, 0)
})

for (const event of ['onaudiostart', 'onresult']) test(`resumed ${event} clears stale microphone retry state and notice`, t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const rec = { starts: 0, start() { this.starts++ }, stop() {} }
  let state; let message
  const controller = createSpeechController(rec, { commit() { return 1 }, preview() {}, state(value) { state = value }, message(value) { message = value } })
  t.after(() => controller.dispose())
  controller.start(); rec.onerror({ error: 'network' }); rec.onend()
  rec.onerror({ error: 'network' })
  assert.equal(state, 'retrying'); assert.ok(message)
  rec[event](event === 'onresult' ? { results: [Object.assign([{ transcript: 'The microphone has recovered.', confidence: .99 }], { isFinal: true })] } : undefined)
  assert.equal(state, 'listening'); assert.equal(message, '')
  const starts = rec.starts
  t.mock.timers.tick(10000)
  assert.equal(rec.starts, starts)
})
