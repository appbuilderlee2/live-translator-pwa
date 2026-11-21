import { test } from 'node:test'
import assert from 'node:assert/strict'
import { semanticMismatch } from '../shared/coverage.mjs'
import { translateWithFallback } from '../src/local.mjs'

const hospital = 'the weather is warm today but it may rain later in the afternoon I would like to take a taxi to the hospital my friend needs some water and a comfortable place to sit while we wait'
const short = 'My friend needs some water and a comfortable place to sit while we wait.'
test('waiting coverage catches dropped while-we-wait without losing the seating check', async () => {
  const correct = '我的朋友需要一些水，以及等候時能舒服坐下的地方。'
  for (const source of [hospital, short]) {
    let fallbacks = 0; const updates = []
    const local = { translate: async chunk => /\bsit\b/.test(chunk) ? '我的朋友需要一些水和一個舒適的地方來坐下。' : '今天天氣暖和，下午可能下雨，我想搭計程車去醫院。' }
    const fallback = async text => { assert.equal(text, source); fallbacks++; return correct }
    assert.equal(await translateWithFallback(local, source, new AbortController().signal, text => updates.push(text), [], {}, fallback), correct)
    assert.equal(fallbacks, 1); assert.deepEqual(updates, [])
    for (const output of [correct, '我的朋友需要一些水和一個舒適的地方坐下等待。', '我的朋友需要一些水，以及在等我們的車時能舒服坐下的地方。']) assert.equal(semanticMismatch(source, output), false)
    assert.equal(semanticMismatch(source, '我的朋友需要一些水和舒適的座位。'), true)
    assert.equal(semanticMismatch(source, '我的朋友需要水和舒適的地方等待。'), true)
  }
  assert.equal(semanticMismatch('Please wait near the window.', '請在窗邊等。'), false)
  assert.equal(semanticMismatch('Please wait.', '請稍候。'), false)
  assert.equal(semanticMismatch('Please wait near the window.', ''), true)
  assert.equal(semanticMismatch('', ''), false)
})
