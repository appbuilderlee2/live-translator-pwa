import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currencySource, protectCurrency } from '../shared/business.mjs'
import { traditional, translationBuffer } from '../shared/traditional.mjs'
import { localTranslation } from '../src/local.mjs'
import { networkTranslation } from '../src/network.mjs'
import { translateHandler } from './handler-fixture.mjs'

const cases = [
  ['The US dollar price is 20 US dollars.', '美元價為 20 美元 元。', '美元價為 20 美元。', false],
  ['20 US dollars', '20 美元 元', '20 美元', false],
  ['20 USD', '20 美元 元', '20 美元', false],
  ['$20', '20 __CURRENCY_UNIT__', '20 元', true],
  ['20 dollars', '20 __CURRENCY_UNIT__', '20 元', true],
  ['US$30.2M', '3020萬美元 元', '3020萬美元', false]
]
const signal = () => new AbortController().signal
const sse = text => new Response([...text].map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n')

test('named currency matching uses an adjacent qualifier even after an earlier currency mention', () => {
  for (const input of ['The US dollar price is 20 US dollars.', 'US dollar price is twenty US dollars.', 'The Canadian dollar price is 20 Canadian dollars.']) {
    assert.equal(protectCurrency(input).text, input)
  }
  assert.equal(protectCurrency('The US dollar price is 20 dollars.').text, 'The US dollar price is 20 __CURRENCY_UNIT__.')
  assert.equal(protectCurrency('').restore(''), '')
  assert.throws(() => protectCurrency('20 dollars').restore('20 美元'), /placeholder was lost/)
})

test('Taiwan output cleans duplicated USD units and generic subway terms, including streamed phrases', () => {
  const input = '美元價為 20 美元 元。地铁站和地铁。'
  const expected = '美元價為 20 美元。捷運站和捷運。'
  assert.equal(traditional(input), expected)
  assert.equal(traditional(''), '')
  assert.equal(traditional('美元匯率與元素'), '美元匯率與元素')
  const chunks = []; const output = translationBuffer(chunk => chunks.push(chunk))
  for (const char of input) output.push(char)
  output.finish()
  assert.equal(chunks.join(''), expected)
})

test('Google, OpenAI and on-device preserve single currency units for typed and spoken input', async t => {
  const original = fetch; const key = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  for (const spoken of [false, true]) {
    for (const [input, answer, expected, neutral] of cases) {
      for (const provider of ['Google', 'OpenAI']) {
        if (provider === 'Google') delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = 'test'
        globalThis.fetch = async (url, options) => {
          const source = provider === 'Google' ? new URL(url).searchParams.get('q') : JSON.parse(options.body).messages.at(-1).content
          assert.equal(source.includes('__CURRENCY_UNIT__'), neutral, `${provider}: ${input}`)
          return provider === 'Google' ? Response.json([[[answer]]]) : sse(answer)
        }
        const response = await translateHandler(new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text: input, spoken }) }))
        assert.equal(response.status, 200)
        assert.equal(await response.text(), expected, `${provider}: ${input}`)
      }
      const local = { translate: async source => { assert.equal(source.includes('__CURRENCY_UNIT__'), neutral); return answer } }
      assert.equal(await localTranslation(local, input, signal(), [], { spoken }), expected, `local: ${input}`)
      globalThis.fetch = async () => new Response(expected.replace(/捷運/g, '地鐵'))
      const updates = []
      assert.equal(await networkTranslation(input, signal(), text => updates.push(text), [], { spoken }), expected)
      assert.equal(updates.at(-1), expected)
      assert.equal(protectCurrency(currencySource(input, spoken)).text.includes('__CURRENCY_UNIT__'), neutral)
    }
  }
})

test('generic subway wording is normalized in Google, OpenAI, on-device and client results', async t => {
  const original = fetch; const key = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  const input = 'Please take a taxi to the subway station. I need a bicycle and a potato.'
  const answer = '請搭計程車到地鐵站。我需要一輛腳踏車和一個馬鈴薯。'
  const expected = answer.replace('地鐵站', '捷運站')
  for (const spoken of [false, true]) {
    for (const provider of ['Google', 'OpenAI']) {
      if (provider === 'Google') delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = 'test'
      globalThis.fetch = async () => provider === 'Google' ? Response.json([[[answer]]]) : sse(answer)
      const response = await translateHandler(new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text: input, spoken }) }))
      assert.equal(response.status, 200)
      assert.equal(await response.text(), expected)
    }
    assert.equal(await localTranslation({ translate: async chunk => chunk.includes('subway') ? '請搭計程車到地鐵站。' : '我需要一輛腳踏車和一個馬鈴薯。' }, input, signal(), [], { spoken }), '請搭計程車到捷運站。 我需要一輛腳踏車和一個馬鈴薯。')
    globalThis.fetch = async () => new Response(answer)
    const updates = []
    assert.equal(await networkTranslation(input, signal(), text => updates.push(text), [], { spoken }), expected)
    assert.equal(updates.at(-1), expected)
  }
})
