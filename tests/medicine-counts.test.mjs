import { test } from 'node:test'
import assert from 'node:assert/strict'
import { medicalTranslation } from '../shared/medical.mjs'
import { traditional } from '../shared/traditional.mjs'
import { localTranslation } from '../src/local.mjs'
import { networkTranslation } from '../src/network.mjs'
import { translateHandler } from './handler-fixture.mjs'

const cases = [
  ['Take two tablets.', '服用兩種藥錠。', '服用兩顆藥錠。'],
  ['Take two tablets after breakfast.', '早餐後服用兩片藥錠。', '早餐後服用兩顆藥錠。'],
  ['Take two tablets.', '服用兩塊 藥錠。', '服用兩顆藥錠。'],
  ['Take 2 tablets.', '服用2種藥錠。', '服用2顆藥錠。'],
  ['Take one pill.', '服用一種藥片。', '服用一顆藥片。'],
  ['Take three capsules.', '服用三種膠囊。', '服用三顆膠囊。'],
  ['Take two kinds of tablets.', '服用兩種藥錠。', '服用兩種藥錠。'],
  ['Take two types of capsules.', '服用兩種膠囊。', '服用兩種膠囊。'],
  ['two tablets', '兩種藥錠', '兩顆藥錠']
]
const signal = () => new AbortController().signal
const sse = text => new Response([...text].map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n')

test('exact clean-reload medical caption preserves tablet count and 140/90 on every path', async t => {
  const original = fetch; const key = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  const text = 'Take two tablets. My blood pressure is 140/90.'
  const answer = '服用兩種藥錠。 我的血壓是 140/90。'
  const expected = '服用兩顆藥錠。 我的血壓是 140/90。'
  for (const spoken of [false, true]) {
    for (const provider of ['Google', 'OpenAI']) {
      if (provider === 'Google') delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = 'test'
      globalThis.fetch = async (url, options) => {
        const input = provider === 'Google' ? new URL(url).searchParams.get('q') : JSON.parse(options.body).messages.at(-1).content
        const output = input.includes('__MEDICINE_TABLET__') ? answer.replace('藥錠', '__MEDICINE_TABLET__') : answer
        return provider === 'Google' ? Response.json([[[output]]]) : sse(output)
      }
      const response = await translateHandler(new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text, spoken }) }))
      assert.equal(response.status, 200); assert.equal(await response.text(), expected)
    }
    assert.equal(await localTranslation({ translate: async chunk => /pressure/.test(chunk) ? '我的血壓是 140/90。' : '服用兩種藥丸。' }, text, signal(), [], { spoken }), expected)
    globalThis.fetch = async () => new Response(answer)
    assert.equal(await networkTranslation(text, signal(), () => {}, [], { spoken }), expected)
  }
})

test('medicine classifier correction is source-counted and preserves kinds, unrelated counts and computers', () => {
  for (const [source, answer, expected] of cases) assert.equal(medicalTranslation(source, answer), expected)
  assert.equal(medicalTranslation('Take two tablets.', '服用兩種平板電腦。'), '服用兩顆藥錠。')
  assert.equal(medicalTranslation('Take two pills.', '服用二粒藥片。'), '服用兩顆藥片。')
  assert.equal(medicalTranslation('Take twenty-one capsules.', '服用二十一種膠囊。'), '服用二十一顆膠囊。')
  assert.equal(medicalTranslation('Take two types of pills.', '服用兩顆藥片。'), '服用兩種藥片。')
  for (const [source, answer] of [
    ['', ''], ['Take medicine.', '服用兩種藥錠。'],
    ['Take two pills.', '服用三種藥片。'],
    ['I bought two types of tablet computers.', '我買了兩種平板電腦。'],
    ['Take two pills and discuss three kinds of treatment.', '服用兩顆藥片並討論三種治療。'],
    ['Compare two kinds of tablets and take two tablets.', '比較兩種藥錠並服用兩顆藥錠。']
  ]) assert.equal(medicalTranslation(source, answer), answer)
})

test('Google and character-streamed OpenAI fixtures correct medicine counts for typed and spoken captions', async t => {
  const original = fetch; const key = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  for (const spoken of [false, true]) {
    for (const provider of ['Google', 'OpenAI']) {
      if (provider === 'Google') delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = 'test'
      for (const [text, answer, expected] of cases) {
        globalThis.fetch = async (url, options) => {
          const source = provider === 'Google' ? new URL(url).searchParams.get('q') : JSON.parse(options.body).messages.at(-1).content
          const result = source.includes('__MEDICINE_TABLET__') ? answer.replace(/藥錠/g, '__MEDICINE_TABLET__') : answer
          return provider === 'Google' ? Response.json([[[result]]]) : sse(result)
        }
        const response = await translateHandler(new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text, spoken }) }))
        assert.equal(response.status, 200)
        assert.equal(await response.text(), expected, `${provider}/${spoken}: ${text}`)
      }
    }
  }
})

test('local and streamed client normalization use the same medicine classifiers', async t => {
  const original = fetch
  t.after(() => { globalThis.fetch = original })
  for (const spoken of [false, true]) {
    for (const [text, answer, expected] of cases) {
      assert.equal(medicalTranslation(text, traditional(answer)), expected)
      assert.equal(await localTranslation({ translate: async () => answer }, text, signal(), [], { spoken }), expected)
      globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
        for (const char of answer) controller.enqueue(new TextEncoder().encode(char))
        controller.close()
      } }))
      const updates = []
      assert.equal(await networkTranslation(text, signal(), value => updates.push(value), [], { spoken }), expected)
      assert.equal(updates.at(-1), expected)
      if (!/kinds|types/.test(text)) assert.ok(updates.every(value => !/種(?:藥錠|藥片|膠囊)/.test(value)))
    }
  }
})
