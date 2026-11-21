import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readableChinese } from '../shared/phrasing.mjs'
import { traditional, translationBuffer } from '../shared/traditional.mjs'

const source = 'recording result carefully makes the experiment easier to repeat a surprising result is not a failure it is a reason to ask a better question this is the end of Section 8'
const raw = '仔細記錄結果使實驗更容易重複 令人驚訝的結果並不是失敗，而是提出更好問題的理由。這是第 8 節的結尾。'
const expected = '仔細記錄結果使實驗更容易重複。令人驚訝的結果並不是失敗，而是提出更好問題的契機。這是第 8 節的結尾。'

test('result clause boundaries accept provider negation variants and adjective result starts', () => {
  assert.equal(readableChinese(source, traditional(raw, source)), expected)
  assert.equal(readableChinese(source, expected), expected)
  for (const adjective of ['surprising', 'unexpected', 'new']) {
    const english = `We completed the experiment the ${adjective} result is useful`
    assert.equal(readableChinese(english, '我們完成了實驗 意外的結果是有用的'), '我們完成了實驗。意外的結果是有用的。')
  }
  assert.equal(readableChinese('We know the surprising result is useful', '我們知道令人驚訝的結果是有用的'), '我們知道令人驚訝的結果是有用的')
  assert.equal(readableChinese('An unrelated short source', raw), raw)
  assert.equal(readableChinese(source, ''), '')
})

test('better-question contrast uses natural wording only with supporting source meaning', () => {
  assert.equal(traditional(raw, source), raw.replace('提出更好問題的理由', '提出更好問題的契機'))
  assert.equal(traditional(expected, source), expected)
  assert.equal(traditional(raw, 'It is a reason to ask a different question'), raw)
  assert.equal(traditional('這不是提出更好問題的理由', 'It is not a reason to ask a better question'), '這不是提出更好問題的理由')
  assert.equal(traditional('這是提出更好問題的理由', source), '這是提出更好問題的理由')
  assert.equal(traditional('', source), '')
})

test('split provider chunks preserve the complete source-backed wording and sentence breaks', () => {
  let output = ''
  const buffer = translationBuffer(chunk => { output += chunk }, source)
  for (const char of raw) buffer.push(char)
  buffer.finish()
  assert.equal(readableChinese(source, output), expected)
  assert.equal(readableChinese(source, traditional(raw, source), false), expected)
})
