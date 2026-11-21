import { test } from 'node:test'
import assert from 'node:assert/strict'
import { medicalWarnings, normalizeMedical, medicalTranslation, protectMedical } from '../shared/medical.mjs'
import { currencySource, protectCurrency, normalizeBusiness } from '../shared/business.mjs'
import { traditional, translationBuffer } from '../shared/traditional.mjs'
import { translateHandler } from './handler-fixture.mjs'

const context = [{ en: 'Please remind me to take my blood pressure medicine at 8:00.', zh: '' }]
const tablets = 'I keep my tablets in the small blue box beside the kitchen window'
const pressure = 'my blood pressure was 140 over 90 this morning'
const label = 'please check the label with the pharmacist before taking this medicine'
const request = (text, extra = {}) => new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text, ...extra }) })
const sse = text => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`)

test('medical normalization uses nearby context without turning computers into medicine', () => {
  assert.match(normalizeMedical(tablets, context), /medicine pills/)
  assert.match(normalizeMedical('Take one tablet twice a day after meals. Do not take more than two tablets in 24 hours.'), /one medicine pill twice a day after meals\. Do not take more than two medicine pills in 24 hours/)
  assert.equal(normalizeMedical(pressure), 'my blood pressure was 140/90 this morning')
  assert.equal(normalizeMedical('My blood pressure was one hundred and forty over ninety.'), 'My blood pressure was 140/90.')
  assert.equal(normalizeMedical('It was 120 over 80.', context), 'It was 120/80.')
  assert.match(normalizeMedical(label), /ask the pharmacist to help check the medicine label before taking this medicine/)
  for (const input of ['', 'The price is 140 over 90.', 'My tablet computer has a bright screen.']) assert.equal(normalizeMedical(input, input.includes('computer') ? context : []), input)
  assert.equal(protectMedical(tablets, context).restore('我把 __MEDICINE_TABLET__ 放在藍色盒子裡。'), '我把 藥錠 放在藍色盒子裡。')
  assert.throws(() => protectMedical(tablets, context).restore('電腦'), /placeholder was lost/)
})

test('medical checks flag saved wrong senses and repair only the corresponding known senses', () => {
  assert.equal(medicalWarnings(tablets, '我把平板電腦放在藍色盒子裡。', context).length, 1)
  assert.equal(medicalWarnings(pressure, '今天早上我的血壓是 140 超過 90。').length, 1)
  assert.equal(medicalWarnings(label, '服用此藥前請諮詢藥師標籤。').length, 1)
  assert.equal(medicalTranslation(tablets, '我把平板電腦放在藍色盒子裡。', context), '我把藥錠放在藍色盒子裡。')
  assert.equal(medicalTranslation(pressure, '今天早上我的血壓是 140 超過 90。'), '今天早上我的血壓是 140/90。')
  assert.equal(medicalTranslation(label, '服用此藥前請諮詢藥師標籤。'), '服用此藥前請藥師協助確認藥品標示。')
  for (const [en, zh, ctx] of [[tablets, '我把藥片放在盒子裡。', context], [pressure, '血壓是 140/90。'], ['The doctor bought a tablet computer.', '醫師買了平板電腦。'], ['', ''], ['This is my tablet.', '這是平板電腦。']]) assert.deepEqual(medicalWarnings(en, zh, ctx), [])
  assert.equal(medicalTranslation('The doctor bought a tablet computer.', '醫師買了平板電腦。', context), '醫師買了平板電腦。')
  assert.equal(medicalTranslation(pressure, '1140 超過 90 和 140 超過 90.5'), '1140 超過 90 和 140 超過 90.5')
})

test('Google and OpenAI protect the report medical meanings and unchanged dosage instructions', async t => {
  const original = fetch; const key = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  const dosage = 'take one tablet twice a day after meals do not take more than two tablets in 24 hours'
  for (const provider of ['Google', 'OpenAI']) {
    if (provider === 'Google') delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = 'test'
    for (const [en, expectedInput, answer, expectedOutput] of [
      [tablets, provider === 'Google' ? /__MEDICINE_TABLET__/ : /medicine pills/, provider === 'Google' ? '我把 __MEDICINE_TABLET__ 放在藍色盒子裡。' : '我把平板電腦放在藍色盒子裡。', /藥錠/],
      [pressure, /140\/90/, '我的血壓是140超過90。', /140\/90/],
      [label, /ask the pharmacist to help check the medicine label/, '服用此藥前請諮詢藥師標籤。', /用此藥前請藥師協助確認藥品標示/],
      [dosage, /twice a day after meals do not take more than two/, provider === 'Google' ? '飯後每次一顆 __MEDICINE_TABLET__，一天兩次，24 小時內不可超過兩顆 __MEDICINE_TABLET__。' : '飯後每次一顆藥錠，一天兩次，24 小時內不可超過兩顆。', /一天兩次，24 小時內不可超過兩顆/]
    ]) {
      globalThis.fetch = async (url, options) => {
        const input = provider === 'Google' ? new URL(url).searchParams.get('q') : JSON.parse(options.body).messages.at(-1).content
        assert.match(input, expectedInput)
        if (provider === 'OpenAI') assert.match(JSON.parse(options.body).messages[0].content, /never 平板電腦/)
        return provider === 'Google' ? Response.json([[[answer]]]) : sse(answer)
      }
      const response = await translateHandler(request(en, { context }))
      assert.equal(response.status, 200); const output = await response.text()
      assert.match(output, expectedOutput); assert.deepEqual(medicalWarnings(en, output, context), [])
    }
    globalThis.fetch = async () => provider === 'Google' ? Response.json([[['']]]) : sse('')
    const response = await translateHandler(request(tablets, { context }))
    if (provider === 'Google') assert.equal(response.status, 502); else await assert.rejects(response.text(), /Empty translation/)
  }
})

test('unqualified dollar symbols stay neutral in typed and spoken text; named currencies remain explicit', async t => {
  assert.equal(currencySource('I have $20 and the fare is $2.', true), 'I have 20 dollars and the fare is 2 dollars.')
  assert.equal(currencySource('I have $20.'), 'I have 20 dollars.')
  assert.equal(currencySource('I have $20 dollars.'), 'I have 20 dollars.')
  for (const input of ['US$20', 'USD $20', '$20 USD', 'CAD$20', 'HK$20']) assert.equal(currencySource(input, true), input)
  for (const input of ['US twenty dollars', 'USD 2 dollars', 'two Canadian dollars', 'two dollars USD']) assert.equal(protectCurrency(input).text, input)
  assert.equal(protectCurrency('US dollars and two dollars').text, 'US dollars and two __CURRENCY_UNIT__')
  assert.equal(protectCurrency('$20 and two dollars').text, '$20 and two __CURRENCY_UNIT__')
  const original = fetch; const key = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  for (const provider of ['Google', 'OpenAI']) {
    if (provider === 'Google') delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = 'test'
    for (const [input, spoken, protectedUnit] of [['The fare is two dollars', false, true], ['The fare is $2', true, true], ['The fare is $2', false, true], ['The fare is US$2', true, false]]) {
      globalThis.fetch = async (url, options) => {
        const source = provider === 'Google' ? new URL(url).searchParams.get('q') : JSON.parse(options.body).messages.at(-1).content
        assert.equal(source.includes('__CURRENCY_UNIT__'), protectedUnit)
        const answer = protectedUnit ? '車資是兩 __CURRENCY_UNIT__。' : '車資是兩美元。'
        return provider === 'Google' ? Response.json([[[answer]]]) : sse(answer)
      }
      const output = await (await translateHandler(request(input, { spoken }))).text()
      assert.equal(output, protectedUnit ? '車資是兩 元。' : '車資是兩美元。')
    }
  }
})

test('safe accidental CJK double collapse preserves legitimate reduplications and community wording', () => {
  assert.equal(traditional('服用此藥前請請藥師幫忙檢視藥品標籤'), '服用此藥前請藥師幫忙檢視藥品標籤')
  assert.equal(traditional('請請請慢慢、常常、謝謝、天天、看看、人人、年年、好好、爸爸、媽媽'), '請慢慢、常常、謝謝、天天、看看、人人、年年、好好、爸爸、媽媽')
  assert.equal(traditional('社群健走活動、社區健走活動、社群步行活動'), '社區健走活動、社區健走活動、社區健走活動')
  assert.equal(traditional(''), '')
  const chunks = []; const output = translationBuffer(text => chunks.push(text))
  output.push('請'); output.push('請參加社區健'); output.push('走活動。'); output.finish()
  assert.equal(chunks.join(''), '請參加社區健走活動。')
})

test('Taiwan report wording works in complete and split streamed translations, without changing foreign systems', () => {
  const source = '公共汽車和巴士，社群步行活動，印刷的說明，將其展示給我的家庭醫生。'
  const expected = '公車和公車，社區健走活動，紙本說明，拿給我的家庭醫師看。'
  assert.equal(traditional(source), expected)
  const chunks = []; const buffer = translationBuffer(chunk => chunks.push(chunk))
  buffer.push('公共汽'); buffer.push('車和巴士，社群步行'); buffer.push('活動，印刷的說明，將其展示給我的家庭醫生。'); buffer.finish()
  assert.equal(chunks.join(''), expected)
  assert.equal(traditional('請搭計程車到臺北地鐵站。'), '請搭計程車到臺北捷運站。')
  assert.equal(normalizeBusiness('Please take a taxi to the Taipei subway station.'), 'Please take a taxi to the 臺北捷運站.')
  assert.equal(normalizeBusiness('Take the subway.', [{ en: 'I am in Taipei.' }]), 'Take the MRT.')
  assert.equal(normalizeBusiness('Take the London subway.'), 'Take the London subway.')
  assert.equal(traditional('倫敦地鐵和巴士海峽'), '倫敦捷運和巴士海峽')
})
