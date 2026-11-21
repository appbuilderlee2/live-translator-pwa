import { test } from 'node:test'
import assert from 'node:assert/strict'
import { traditional } from '../shared/traditional.mjs'
import { localTranslation } from '../src/local.mjs'
import { networkTranslation } from '../src/network.mjs'
import { recoverSegment } from '../src/transcript.mjs'
import { translateHandler } from './handler-fixture.mjs'

test('numbered railway platforms use Taiwan wording without rewriting software platforms or unrelated numbers', () => {
  for (const en of ['Please help us find platform 6.', 'Our train leaves from platform six.']) {
    for (const zh of ['請幫我們找到平臺6。', '請幫我們找到6平臺。', '請幫我們找到第六平臺。']) assert.equal(traditional(zh, en), '請幫我們找到6號月臺。')
    assert.equal(recoverSegment({ en, zh: '平臺6', status: 'done' }).zh, '6號月臺')
  }
  for (const en of ['', 'Use software platform 6.', 'Cloud platform 6 supports trains.', 'Find platform 7.', 'Upgrade platform 6.', 'Stand on platform 6.', 'Find launch platform 6.', 'Find platform 6 at the concert.']) assert.equal(traditional('平臺6', en), '平臺6')
  assert.equal(traditional('', 'Find platform 6.'), '')
})

test('Google/OpenAI, local and character-streamed client paths normalize numbered railway platforms', async t => {
  const original = fetch; const key = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key })
  const text = 'Please help us find platform 6.'; const answer = '請幫我們找到平臺6。'; const expected = '請幫我們找到6號月臺。'
  for (const spoken of [true, false]) {
    for (const provider of ['Google', 'OpenAI']) {
      if (provider === 'Google') delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = 'test'
      globalThis.fetch = async () => provider === 'Google' ? Response.json([[[answer]]]) : new Response([...answer].map(content => `data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`).join('') + 'data: [DONE]\n\n')
      const response = await translateHandler(new Request('http://localhost/api/translate', {method:'POST',body:JSON.stringify({text,spoken})}))
      assert.equal(response.status, 200); assert.equal(await response.text(), expected)
    }
    assert.equal(await localTranslation({translate:async()=>answer},text,new AbortController().signal,[],{spoken}),expected)
    globalThis.fetch = async () => new Response(new ReadableStream({start(controller){for(const char of answer)controller.enqueue(new TextEncoder().encode(char));controller.close()}}))
    const updates=[];assert.equal(await networkTranslation(text,new AbortController().signal,value=>updates.push(value),[],{spoken}),expected)
    assert.equal(updates.at(-1),expected)
  }
})
