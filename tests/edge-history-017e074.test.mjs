import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localTranslation, localChunks } from '../src/local.mjs'
import { networkTranslation } from '../src/network.mjs'
import { readableChinese } from '../shared/phrasing.mjs'
import { recoverSegment } from '../src/transcript.mjs'

const source = 'please reserve free tickets for $250 at 7:30 this evening my family will arrive at the main entrance we have two adults and one child please write the total price on the receipt'
const dense = '請在今晚 7:30 預訂 250 元 的免費門票，我的家人將到達主入口 我們有兩個成人和一個孩子。 請在收據上寫下總價。'
const expected = dense.replace('主入口 我們', '主入口。我們')
const signal = () => new AbortController().signal

test('reported entrance/adults break is formatted across whitespace, without altering numbers or dependent clauses', async t => {
  const original = fetch; t.after(() => { globalThis.fetch = original })
  assert.equal(readableChinese(source, dense), expected)
  assert.equal(readableChinese(source, expected), expected)
  assert.equal(readableChinese(source, dense.replace('主入口 我們', '主入口我們')), expected)
  assert.equal(readableChinese(source, ''), '')
  assert.equal(readableChinese(source, '他說 我們有兩個成人和一個孩子。'), '他說 我們有兩個成人和一個孩子。')
  assert.equal(recoverSegment({ en: source, zh: dense, status: 'done' }).zh, expected)
  globalThis.fetch = async () => new Response(dense)
  assert.equal(await networkTranslation(source, signal(), () => {}), expected)
})

test('report train caption still makes four distinct bounded local calls, not revision/settle duplicates', async () => {
  const text = 'tomorrow morning hour train leave at 9:15 we need four bottles of water and two sandwiches for the journey please help us find platform 6 thank you for speaking slowly and explaining the directions so clearly'
  const calls = []
  const outputs = ['明天早上 9:15 火車出發', '我們需要四瓶水和兩個三明治', '請幫我們找平台6', '謝謝你說話很慢，解釋這麼清楚的方向']
  const result = await localTranslation({ translate: async chunk => { calls.push(chunk); return outputs[calls.length - 1] } }, text, signal())
  assert.deepEqual(calls, localChunks(text)); assert.equal(calls.length, 4); assert.equal(new Set(calls).size, 4)
  assert.match(result, /6號月臺。/)
  assert.equal(await localTranslation({ translate: async chunk => { assert.equal(chunk, 'Hello'); return '你好' } }, 'Hello', signal()), '你好')
  console.log('Report train caption: local calls before 4 / after 4; distinct chunks 4; server calls 0; short Hello 1 call')
})
