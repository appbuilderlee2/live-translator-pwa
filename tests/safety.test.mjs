import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBusiness, protectNames, protectCurrency, meetingPrompt } from '../shared/business.mjs'
import { traditional, translationBuffer } from '../shared/traditional.mjs'
import { numericMismatch, numericValues, splitText, recoverSegment, retryableSegments, previousContext, patchSegment } from '../src/transcript.mjs'
import { createSpeechController } from '../src/speech.mjs'
import { speakTranslation } from '../src/voice.mjs'
import { networkTranslation } from '../src/network.mjs'

test('business idioms preserve the intended meeting action', () => {
  assert.equal(normalizeBusiness("Don't book the renewal until procurement signs off on July 23rd."), "Don't record the renewal until procurement approves on July 23rd.")
  assert.equal(normalizeBusiness('Take the rest offline; Maya Chen will send the board deck.'), 'discuss the rest separately; Maya Chen will send the board presentation slides.')
  assert.equal(normalizeBusiness('We book revenue after they sign off.'), 'We record revenue after they approve.')
  assert.equal(normalizeBusiness(''), '')
  const names = protectNames('Maya Chen and Fiona Campbell met Maya Chen on June Fifteenth.')
  assert.equal(names.text, '__PERSON_0__ and __PERSON_1__ met __PERSON_0__ on June Fifteenth.')
  assert.equal(names.restore('__PERSON_0__ 與 __PERSON_1__ 會面 __PERSON_0__'), 'Maya Chen 與 Fiona Campbell 會面 Maya Chen')
  assert.throws(() => names.restore('陳小姐'), /lost/)
  assert.equal(protectNames('Hello!').restore('你好'), '你好')
})
test('bare dollars stay unspecified; named currencies are not stripped', () => {
  const bare = protectCurrency('The bus fare is two dollars.')
  assert.equal(bare.text, 'The bus fare is two __CURRENCY_UNIT__.')
  assert.equal(bare.restore('車資是兩__CURRENCY_UNIT__。'), '車資是兩元。')
  assert.throws(() => bare.restore('兩美元'), /lost/)
  for (const value of ['2 US dollars', 'USD 2 dollars', '$2 dollars', 'two dollars USD', 'two Canadian dollars']) assert.equal(protectCurrency(value).text, value)
  assert.match(meetingPrompt, /Taiwan only/); assert.match(meetingPrompt, /never assume 美元/)
})
test('Taiwan phrase conversion covers whole results and split streaming phrases', () => {
  assert.equal(traditional('博物馆周日开放吗'), '博物館週日開放嗎')
  assert.equal(traditional(''), '')
  const chunks = []; const stream = translationBuffer(text => chunks.push(text))
  stream.push('博物'); stream.push('馆周'); stream.push('日开放吗？'); stream.finish()
  assert.equal(chunks.join(''), '博物館週日開放嗎？')
})
test('numeric check normalizes million, comma figures, 萬 and 億 and counts repeats', () => {
  assert.equal(numericMismatch('2.4 million US dollars', '240萬美元'), false)
  assert.equal(numericMismatch('15.4 million', '1540萬'), false)
  assert.equal(numericMismatch('2.4 million', '1540萬'), true)
  assert.equal(numericMismatch('2 billion and 25 basis points, not 25%', '20億與25個基點，不是25%'), false)
  assert.equal(numericMismatch('25 and 25', '25'), true)
  assert.equal(numericMismatch('July 23rd', '7月23日'), false)
  assert.deepEqual(numericValues('2,400,000'), [2400000])
  assert.equal(numericMismatch('No figures', '沒有數字'), false)
  assert.equal(numericMismatch('110%', ''), true)
})
test('long input is split without truncation and history resumes without cross-session context', () => {
  const text = 'Please tell me where the nearest train station is. '.repeat(100).trim()
  const chunks = splitText(text)
  assert.equal(chunks.join(' '), text); assert.ok(chunks.every(s => s.length <= 2000 && s.endsWith('.')))
  assert.equal(splitText('x'.repeat(5001)).join(''), 'x'.repeat(5001)); assert.deepEqual(splitText(' '), [])
  const current = [{ id: 'c', en: 'new', zh: '', status: 'error' }]
  const saved = { id: 'h', segments: [{ id: 'a', en: 'Maya Chen', zh: 'Maya Chen', status: 'done' }, { id: 'b', en: 'board deck', zh: '', status: 'translating' }] }
  saved.segments = saved.segments.map(recoverSegment)
  assert.equal(saved.segments[1].status, 'pending')
  assert.deepEqual(retryableSegments(current, [saved]).map(s => s.id), ['c', 'b'])
  assert.deepEqual(previousContext('b', current, [saved]), [{ en: 'Maya Chen', zh: 'Maya Chen' }])
  assert.deepEqual(previousContext('c', current, [saved]), [])
  assert.equal(patchSegment(saved.segments, 'b', { status: 'done' })[1].status, 'done')
  assert.equal(recoverSegment({ zh: '开放', status: 'done' }).zh, '開放')
})
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const commits = []; const states = []; const messages = []; const previews = []
  const rec = { starts: 0, stops: 0, start() { this.starts++ }, stop() { this.stops++ } }
  const controller = createSpeechController(rec, { commit: (text, meta) => commits.push({ text, ...meta }), preview: text => previews.push(text), state: text => states.push(text), message: text => messages.push(text) })
  const result = (text, final = false, confidence = .6) => { const row = [{ transcript: text, confidence }]; row.isFinal = final; return row }
  const emit = (...results) => rec.onresult({ resultIndex: 0, results })
  t.after(() => controller.dispose())
  return { rec, controller, result, emit, commits, states, messages, previews }
}
test('speech requests permission before listening; clears errors, flushes interim and restarts', t => {
  const f = fixture(t); f.controller.start()
  assert.equal(f.states.at(-1), 'requesting'); assert.equal(f.rec.maxAlternatives, 3)
  f.rec.onstart(); assert.equal(f.states.at(-1), 'listening')
  f.rec.onerror({ error: 'no-speech' }); assert.match(f.messages.at(-1), /No speech/)
  f.emit(f.result('Do not lose this')); assert.equal(f.messages.at(-1), '')
  t.mock.timers.tick(1200); assert.equal(f.rec.stops, 1)
  f.rec.onend(); assert.equal(f.commits[0].text, 'Do not lose this'); assert.equal(f.commits[0].confidence, .6); assert.equal(f.commits[0].forced, true)
  t.mock.timers.tick(150); assert.equal(f.rec.starts, 2)
  f.rec.onend(); assert.equal(f.commits.length, 1)
})
test('speech finals replace interims once; long/unchanged drafts force a boundary; denial is visible', t => {
  const f = fixture(t); f.controller.start()
  f.emit(f.result('First draft')); f.emit(f.result('First final', true, .95)); f.emit(f.result('First final', true, .95))
  assert.equal(f.commits.length, 1); assert.equal(f.commits[0].text, 'First final')
  f.emit(f.result('First final', true), f.result('word '.repeat(26)))
  assert.equal(f.rec.stops, 1); f.rec.onend(); assert.equal(f.commits.length, 2)
  f.rec.onerror({ error: 'not-allowed' }); assert.equal(f.states.at(-1), 'idle'); assert.match(f.messages.at(-1), /not-allowed/)
})
test('manual finish retains pending speech before the session is archived', async t => {
  const f = fixture(t); f.controller.start(); f.emit(f.result('Last action item'))
  const finished = f.controller.finish(); f.rec.onend(); await finished
  assert.equal(f.commits[0].text, 'Last action item'); t.mock.timers.tick(150); assert.equal(f.rec.starts, 1)
})
test('voice errors are visible; async voices and speed/selection are respected', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const messages = []; let listener; let spoken; let voices = []
  const synth = { getVoices: () => voices, addEventListener: (_e, fn) => { listener = fn }, removeEventListener() {}, cancel() {}, speak: u => { spoken = u } }
  const pending = speakTranslation('你好', synth, class { constructor(text) { this.text = text } }, m => messages.push(m), { choice: 'zh-HK', rate: .8 })
  voices = [{ lang: 'zh-HK', voiceURI: 'hk' }]; listener(); await pending
  assert.equal(spoken.voice.voiceURI, 'hk'); assert.equal(spoken.rate, .8)
  spoken.onerror({ error: 'synthesis-failed' }); assert.match(messages.at(-1), /朗讀失敗/)
  voices = []; const missing = speakTranslation('你好', synth, class {}, m => messages.push(m)); t.mock.timers.tick(900); await missing
  assert.match(messages.at(-1), /未安裝/); assert.match(messages.at(-1), /settings/)
})
test('client retries an interrupted stream independently of newer committed segments', async () => {
  const original = globalThis.fetch; let attempts = 0; const signals = []
  try {
    globalThis.fetch = async (_url, options) => {
      signals.push(options.signal)
      if (++attempts === 1) return new Response(new ReadableStream({ start(c) { c.error(new Error('interrupted')) } }))
      return new Response('博物馆周日开放吗')
    }
    const first = new AbortController(); const second = new AbortController()
    const result = await Promise.all([networkTranslation('First', first.signal, () => {}), networkTranslation('Second', second.signal, () => {})])
    assert.deepEqual(result, ['博物館週日開放嗎', '博物館週日開放嗎']); assert.equal(attempts, 3); assert.ok(signals.every(s => !s.aborted))
    globalThis.fetch = async () => new Response('bad request', { status: 400 })
    await assert.rejects(networkTranslation('bad', first.signal, () => {}), /Retry/)
    first.abort(); await assert.rejects(networkTranslation('stale preview', first.signal, () => {}), /abort/i)
  } finally { globalThis.fetch = original }
})
