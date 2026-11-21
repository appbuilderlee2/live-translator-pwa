import { test } from 'node:test'
import assert from 'node:assert/strict'
import { negationMismatch, normalizeNegations } from '../shared/negation.mjs'
import { numericValues } from '../src/numbers.mjs'
import { translateHandler } from './handler-fixture.mjs'
import { networkTranslation } from '../src/network.mjs'

const en = 'from 12.5 million to 13.2 million US dollars not 30.2 million keep the forecast'
const bad = '從 1250 萬美元到 1320 萬美元 保持預測不變 3020 萬美元'
const good = '從 1250 萬美元到 1320 萬美元，不是 3020 萬美元。保持預測不變。'
const request = text => new Request('http://localhost/api/translate', { method: 'POST', body: JSON.stringify({ text }) })

test('missing negations and misplaced numerical exclusions are flagged, not unrelated 不變', () => {
  assert.equal(negationMismatch(en, bad), true)
  assert.equal(negationMismatch(en, good), false)
  assert.equal(negationMismatch('not thirty point two million', '不是三十點二百萬'), false)
  assert.deepEqual(numericValues('十二點五百萬、十三點二百萬、三十點二百萬'), [12500000, 13200000, 30200000])
  for (const text of ["Don't record revenue", 'Never record revenue', 'No approval', 'We cannot approve', 'We can’t approve', 'Without approval']) assert.equal(negationMismatch(text, '記錄收入並批准'), true)
  for (const zh of ['不要記錄收入', '沒有批准', '未批准', '非正式批准', '別批准', '無批准']) assert.equal(negationMismatch('No approval', zh), false)
  assert.equal(negationMismatch('', ''), false)
  assert.equal(negationMismatch('Record revenue', '記錄收入'), false)
  assert.equal(negationMismatch('Never record revenue', ''), true)
  assert.equal(negationMismatch('not 25 percent', '不到百分之二十五'), true)
})

test('Google input normalizes contractions and separates numeric exclusions from following commands', () => {
  assert.equal(normalizeNegations(en), 'from 12.5 million to 13.2 million US dollars, not 30.2 million. keep the forecast')
  assert.equal(normalizeNegations("Don't record it. We can't approve and won't pay."), 'Do not record it. We can not approve and will not pay.')
  assert.equal(normalizeNegations('not thirty point two million keep the forecast'), 'not thirty point two million. keep the forecast')
  assert.equal(normalizeNegations(''), '')
})

test('Google rejects a lost exclusion once and accepts a later normalized retry', async () => {
  const original = globalThis.fetch; const key = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY
  try {
    let calls = 0
    globalThis.fetch = async url => {
      assert.match(new URL(url).searchParams.get('q'), /not 30\.2 million\. keep the forecast/)
      return Response.json([[[++calls === 1 ? bad : good, '']]])
    }
    assert.equal((await translateHandler(request(en))).status, 502); assert.equal(calls, 1)
    const response = await translateHandler(request(en))
    assert.equal(response.status, 200); assert.equal(await response.text(), good); assert.equal(calls, 2)
    globalThis.fetch = async () => Response.json([[[bad, '']]])
    assert.equal((await translateHandler(request(en))).status, 502)
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key }
})

test('OpenAI stream fails rather than completing a translation with a lost exclusion', async () => {
  const original = globalThis.fetch; const key = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test'
  try {
    const stream = text => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`)
    globalThis.fetch = async (_url, options) => {
      assert.match(JSON.parse(options.body).messages[0].content, /scope of every not/)
      return stream(bad)
    }
    await assert.rejects((await translateHandler(request(en))).text(), /negation/)
    globalThis.fetch = async () => stream(good)
    assert.equal(await (await translateHandler(request(en))).text(), good)
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key }
})

test('client rejects a legacy result with missing negation, leaving retries to the committed queue', async () => {
  const original = globalThis.fetch; let calls = 0
  try {
    globalThis.fetch = async () => new Response(++calls === 1 ? bad : good)
    await assert.rejects(networkTranslation(en, new AbortController().signal, () => {}), /Negation/)
    assert.equal(calls, 1)
    assert.equal(await networkTranslation(en, new AbortController().signal, () => {}), good)
    assert.equal(calls, 2)
  } finally { globalThis.fetch = original }
})
