import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechController } from '../src/speech.mjs'
import { createTranslationQueue } from '../src/translation-queue.mjs'
import { reviseRecognizedSegment } from '../src/transcript.mjs'
import { readableChinese } from '../shared/phrasing.mjs'
import { diagnosticsEnabled, exportDispatchDiagnostics, recordTranslationDispatch, speechEvidence } from '../src/diagnostics.mjs'

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

test('short science clauses and section endings bypass length gate without inventing words', () => {
  const source = 'same recording result carefully makes the experiment easier to repeat afterprising result is not a failure it is a reason to ask a better'
  const chinese = '仔細記錄相同的結果使實驗更容易重複 令人驚訝的結果不是失敗而是要求更好的理由'
  const expected = '仔細記錄相同的結果使實驗更容易重複。令人驚訝的結果不是失敗而是要求更好的理由'
  assert.equal(readableChinese(source, chinese), expected)
  assert.equal(readableChinese(source, expected), expected)
  assert.equal(readableChinese(source, ''), '')
  assert.equal(readableChinese('An unrelated short source', chinese), chinese)
  assert.equal(readableChinese('question this is the end of Section 8', '問題這是第 8 節的結尾'), '問題。這是第 8 節的結尾。')
  assert.equal(readableChinese('question this is the end of Section 8', '問題這是第 8 節的結尾', false), '問題。這是第 8 節的結尾')
})

for (const final of [true, false]) test(`native noun phrase stays together; final=${final}; restart/Stop requests remain once-only`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const captions = new Map(); const requests = []; const states = []; let id = 0
  const queue = createTranslationQueue({ find: id => captions.get(id), online: () => true, changed: state => states.push(state), execute: async segment => { requests.push(segment.en); captions.set(segment.id, { ...segment, status: 'done', zh: '翻譯完成', translation: { source: segment.en, text: '翻譯完成' } }) } })
  const rec = { start() {}, stop() { this.onend() } }
  const speech = createSpeechController(rec, {
    commit(en, metadata) { const key = ++id; captions.set(key, { id: key, en, timestamp: id, status: 'pending', ...metadata }); queue.enqueue(key); return key },
    revise(id, en, metadata) { captions.set(id, reviseRecognizedSegment(captions.get(id), en, metadata)); queue.enqueue(id) },
    preview() {}, state() {}, message() {}
  })
  t.after(() => { speech.dispose(); queue.dispose() })
  const source = `${Array(27).fill('Words').join(' ')} ask a better question this is the end of section eight and we will continue after the next break tomorrow morning`
  const emit = (final, text = source) => rec.onresult({ results: [Object.assign([{ transcript: text, confidence: .9 }], { isFinal: final })] })
  const tick = async ms => { t.mock.timers.tick(ms); await flush() }
  speech.start()
  if (final) { emit(false, source.slice(0, source.indexOf(' question'))); await tick(1500) }
  emit(false); await tick(1500); await tick(10000)
  assert.deepEqual(requests, [])
  if (final) emit(true)
  rec.onerror({ error: 'network' }); rec.onend(); await tick(250)
  for (let i = 0; i < 5; i++) await tick(6000)
  if (!final) assert.deepEqual(requests, [])
  speech.stop()
  for (let i = 0; i < 8; i++) await tick(6000)
  assert.equal(requests.join(' '), source)
  assert.ok(requests.some(text => text.includes('ask a better question')))
  assert.ok(requests.every(text => !/a better$/.test(text)))
  assert.equal(new Set(requests).size, requests.length)
  assert.equal(states.at(-1).pending, 0)
  if (!final) emit(true)
  for (let i = 0; i < 5; i++) await tick(6000)
  assert.equal(requests.join(' '), source)
})

test('dispatch diagnostics are opt-in, bounded, exportable and tolerate denied/corrupt storage', () => {
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const segment = { id: 'caption', en: 'A question', spoken: true, status: 'error', provisional: false, forced: false, settled: true, unconfirmed: false, recognitionEvidence: { session: 1, finalRanges: [{ end: 2 }], range: [0, 2], terminal: false } }
  assert.equal(diagnosticsEnabled(storage), false)
  recordTranslationDispatch(segment, [], storage)
  assert.deepEqual(JSON.parse(exportDispatchDiagnostics(storage)).records, [])
  values.set('lt-dispatch-diagnostics', '1')
  recordTranslationDispatch(segment, [{ en: 'Prior caption', zh: '上一段' }], storage)
  const [record] = JSON.parse(exportDispatchDiagnostics(storage)).records
  assert.equal(record.captionId, 'caption'); assert.equal(record.reason, 'native-final-ready'); assert.equal(record.retry, true)
  assert.deepEqual(record.evidence, segment.recognitionEvidence); assert.equal(record.context[0].en, 'Prior caption')
  for (let i = 0; i < 505; i++) recordTranslationDispatch({ ...segment, unconfirmed: true }, [], storage)
  assert.equal(JSON.parse(exportDispatchDiagnostics(storage)).records.length, 500)
  assert.equal(JSON.parse(exportDispatchDiagnostics(storage)).records.at(-1).reason, 'session-end-unconfirmed')
  values.set('lt-dispatch-log', 'broken json'); assert.equal(JSON.parse(exportDispatchDiagnostics(storage)).records.length, 0)
  const denied = { getItem() { throw Error('denied') }, setItem() { throw Error('denied') } }
  assert.equal(diagnosticsEnabled(denied), false); assert.doesNotThrow(() => recordTranslationDispatch(segment, [], denied))
  assert.deepEqual(JSON.parse(exportDispatchDiagnostics(denied)).records, [])
  assert.deepEqual(speechEvidence({}, 0, 0), {})
})
