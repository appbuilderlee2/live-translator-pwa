import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSpokenNumbers } from '../shared/numbers.mjs'
import { currencySource } from '../shared/business.mjs'
import { traditional } from '../shared/traditional.mjs'
import { localTranslation } from '../src/local.mjs'
import { networkTranslation } from '../src/network.mjs'
import { translateHandler } from './handler-fixture.mjs'
import { readableChinese, speechClauses } from '../shared/phrasing.mjs'
import { recognitionWarnings } from '../src/numbers.mjs'
import { createSpeechController } from '../src/speech.mjs'
import { recoverSegment } from '../src/transcript.mjs'
import { formatTranscript } from '../src/export.mjs'

const source = 'twelve point five million US dollars'
const answer = '十二點五百萬美元'
const expected = '1250萬美元'
const signal = () => new AbortController().signal
const sse = text => new Response([...text].map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n')
const budget = 'the approved budget is 2.4 million US Dollars Revenue was 12.5 million last year this year revenue is 13.2 million US Dollars gross margin went down by 25 basis points net revenue retention must stay above 110%'
const denseBudget = '批准預算為240萬美元 去年收入為1250萬美元 今年收入為1320萬美元 毛利率下降25個基點 淨收入保留率必須保持在110%以上。'
const readableBudget = '批准預算為240萬美元。去年收入為1250萬美元。今年收入為1320萬美元。毛利率下降25個基點。淨收入保留率必須保持在110%以上。'

test('high-confidence final warnings show captured alternatives, never an invented correction', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const segments = []; const rec = { start() {}, stop() {} }
  const controller = createSpeechController(rec, { commit(en, meta) { segments.push({ en, zh: '', timestamp: 0, status: 'pending', ...meta }); return 0 }, revise(id, en, meta) { Object.assign(segments[id], { en, ...meta }) }, preview() {}, state() {}, message() {} })
  t.after(() => controller.dispose()); controller.start()
  const emit = alternative => rec.onresult({ results: [Object.assign([{ transcript: 'The budget is 15.4 million US dollars.', confidence: .96 }, { transcript: `The budget is ${alternative} million US dollars.`, confidence: .94 }], { isFinal: true })] })
  emit('50.4')
  let warning = recognitionWarnings(segments[0]).join('; ')
  assert.match(warning, /Recognized number may be wrong/); assert.match(warning, /Heard: 15.4M/); assert.match(warning, /Alternatives: 50.4M/); assert.doesNotMatch(warning, /2\.4M/)
  emit('2.4')
  warning = recognitionWarnings(segments[0]).join('; ')
  assert.match(warning, /Alternatives: 2.4M/)
  const saved = recoverSegment(JSON.parse(JSON.stringify(segments[0])))
  assert.match(formatTranscript([saved], recognitionWarnings), /Heard: 15.4M; 候選 \/ Alternatives: 2.4M/)
  assert.deepEqual(recognitionWarnings({ en: 'No figures' }), [])
  assert.deepEqual(recognitionWarnings({ en: 'The budget is 2.4 million.', numericAlternatives: [[2400000]] }), [])
})

test('only complete punctuated finals settle early; revisions restart the hold and interims never settle', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const segments = []; const rec = { start() {}, stop() {} }
  const controller = createSpeechController(rec, { commit(en, meta) { segments.push({ en, ...meta }); return segments.length - 1 }, revise(id, en, meta) { Object.assign(segments[id], { en, ...meta }) }, preview() {}, state() {}, message() {} })
  t.after(() => controller.dispose()); controller.start()
  const emit = (text, final = true) => rec.onresult({ results: [Object.assign([{ transcript: text, confidence: .99 }], { isFinal: final })] })
  emit('The budget is approved.', false); t.mock.timers.tick(3000)
  assert.ok(segments.every(segment => !segment.settled))
  emit('The budget is approved.'); t.mock.timers.tick(749)
  assert.equal(segments[0].settled, false)
  emit('The budget is approved today.'); t.mock.timers.tick(749)
  assert.equal(segments[0].settled, false)
  t.mock.timers.tick(1); assert.equal(segments[0].settled, true)
  emit('The budget is approved tomorrow'); t.mock.timers.tick(1999)
  assert.equal(segments[0].settled, false)
  t.mock.timers.tick(1); assert.equal(segments[0].settled, true)
  emit('My blood pressure was.'); t.mock.timers.tick(3000)
  assert.ok(segments.filter(segment => /pressure/.test(segment.en)).every(segment => !segment.settled))
})

test('caption 03 gains source-backed boundaries without changing figures or dependent clauses', () => {
  assert.equal(speechClauses(budget).length, 5)
  assert.equal(readableChinese(budget, denseBudget), readableBudget)
  assert.equal(readableChinese(budget, readableBudget), readableBudget)
  assert.equal(readableChinese(budget, denseBudget.replaceAll(' ', '')), readableBudget)
  assert.equal(readableChinese(budget, ''), '')
  assert.equal(readableChinese('We know gross margin went down.', '我們知道毛利率下降。'), '我們知道毛利率下降。')
  assert.equal(readableChinese('We know gross margin went down and we know that these figures need further review before the next meeting so please check every source carefully with the finance team', '我們知道毛利率下降。'), '我們知道毛利率下降。')
})

test('caption 03 is readable on local and cumulative client display paths', async t => {
  const original = fetch
  t.after(() => { globalThis.fetch = original })
  const lines = readableBudget.match(/[^。]+。/g)
  let index = 0
  assert.equal(await localTranslation({ translate: async () => lines[index++] }, budget, signal()), readableBudget.replaceAll('。', '。 ').trim())
  globalThis.fetch = async () => new Response(denseBudget)
  assert.equal(await networkTranslation(budget, signal(), () => {}), readableBudget)
})

test('scaled spoken words become digits without changing dosage, dates or unscaled words', () => {
  assert.equal(currencySource(source, true), '12500000 US dollars')
  assert.equal(normalizeSpokenNumbers('twelve point five million to thirteen point two million, not thirty point two million'), '12500000 to 13200000, not 30200000')
  for (const text of ['', 'one tablet twice daily', 'July twenty third', '2.4 million US dollars', 'one and two', 'twelve point five million and thirteen point two million', 'one million two hundred thousand']) assert.equal(normalizeSpokenNumbers(text), text)
  assert.equal(traditional(answer), expected)
  assert.equal(traditional('十三點二百萬美元，不是三十點二百萬美元'), '1320萬美元，不是3020萬美元')
  assert.equal(traditional('預訂\u200B\u200B完成'), '預訂完成')
})

test('spoken scaled currency has compact Taiwan figures on Google/OpenAI/local/client paths', async t => {
  const original = fetch; const key = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  for (const spoken of [true, false]) {
    for (const provider of ['Google', 'OpenAI']) {
      if (provider === 'Google') delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = 'test'
      globalThis.fetch = async (url, options) => {
        assert.equal(provider === 'Google' ? new URL(url).searchParams.get('q') : JSON.parse(options.body).messages.at(-1).content, '12500000 US dollars')
        return provider === 'Google' ? Response.json([[[answer]]]) : sse(answer)
      }
      const response = await translateHandler(new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text: source, spoken }) }))
      assert.equal(response.status, 200); assert.equal(await response.text(), expected)
    }
    assert.equal(await localTranslation({ translate: async text => { assert.equal(text, '12500000 US dollars'); return answer } }, source, signal(), [], { spoken }), expected)
    globalThis.fetch = async () => new Response(answer)
    assert.equal(await networkTranslation(source, signal(), () => {}, [], { spoken }), expected)
  }
})
