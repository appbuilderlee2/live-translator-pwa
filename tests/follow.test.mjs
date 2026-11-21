import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTranscriptFollower, jumpLabel } from '../src/follow.mjs'

test('jump appears only with content below, never labels zero or saved captions as new', () => {
  for (const saved of [false, true]) {
    assert.equal(jumpLabel(true, 2, saved, 500), '')
    assert.equal(jumpLabel(false, 0, saved, 0), '')
    assert.equal(jumpLabel(false, 2, saved, 80), '')
    assert.equal(jumpLabel(false, 0, saved, 500), '跳至底部 / Jump to bottom')
  }
  assert.match(jumpLabel(false, 2, false, 500), /2 則新字幕/)
  assert.equal(jumpLabel(false, 2, true, 500), '跳至底部 / Jump to bottom')
})

test('follows only near the bottom and counts new captions, not streamed updates', () => {
  const follower = createTranscriptFollower()
  const element = { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 }
  assert.deepEqual(follower.update(element, ['a']), { following: true, unread: 0 })
  element.scrollTop = 100
  follower.scroll(element)
  assert.deepEqual(follower.update(element, ['a', 'b']), { following: false, unread: 1 })
  assert.equal(element.scrollTop, 100)
  assert.equal(follower.update(element, ['a', 'b']).unread, 1)
  assert.equal(follower.update(element, ['a', 'b', 'c']).unread, 2)
  follower.jump(element)
  assert.deepEqual(follower.update(element, ['a', 'b', 'c', 'd']), { following: true, unread: 0 })
  element.scrollTop = 720
  follower.scroll(element)
  assert.equal(follower.update(element, ['a']).following, true)
  element.scrollTop = 719
  follower.scroll(element)
  assert.equal(follower.update(element, ['a']).following, false)
})

test('empty transcripts and a fresh session start following without unread captions', () => {
  const follower = createTranscriptFollower()
  const element = { scrollHeight: 0, clientHeight: 200, scrollTop: 0 }
  assert.equal(follower.update(element, []).unread, 0)
  assert.deepEqual(follower.scroll(element), { following: true, unread: 0 })
  assert.deepEqual(follower.update(element, ['first']), { following: true, unread: 0 })
})

test('content resizing after a programmatic scroll keeps following until the user moves', () => {
  const follower = createTranscriptFollower()
  const element = { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 }
  follower.update(element, ['a'])
  element.scrollHeight = 2000
  assert.equal(follower.scroll(element).following, true)
  follower.update(element, ['a'])
  assert.equal(element.scrollTop, 2000)
  element.scrollTop = 100
  assert.equal(follower.scroll(element).following, false)
})

test('anchors a scrolled-back caption while translations above it grow, without counting them as new', () => {
  const follower = createTranscriptFollower()
  const heights = Array(10).fill(100)
  const element = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, getBoundingClientRect: () => ({ top: 50 }), querySelectorAll: () => rows, contains: row => rows.includes(row) }
  const rows = heights.map((_, i) => ({ isConnected: true, getBoundingClientRect: () => ({ top: 50 + heights.slice(0, i).reduce((a, b) => a + b, 0) - element.scrollTop, bottom: 50 + heights.slice(0, i + 1).reduce((a, b) => a + b, 0) - element.scrollTop }) }))
  const ids = heights.map((_, i) => String(i))
  follower.update(element, ids)
  element.scrollTop = 325
  follower.scroll(element)
  const offset = rows[3].getBoundingClientRect().top
  heights[0] += 250; heights[2] += 175; element.scrollHeight += 425
  assert.deepEqual(follower.update(element, ids), { following: false, unread: 0 })
  assert.equal(element.scrollTop, 750)
  assert.equal(rows[3].getBoundingClientRect().top, offset)
  assert.equal(follower.scroll(element).following, false)
  assert.equal(follower.update(element, [...ids, 'new']).unread, 1)
  assert.equal(element.scrollTop, 750)
  follower.jump(element)
  assert.deepEqual(follower.update(element, [...ids, 'new']), { following: true, unread: 0 })
})

test('a removed reading anchor is replaced, and empty or detached rows do not throw', () => {
  const follower = createTranscriptFollower()
  let rows = [{ isConnected: true, getBoundingClientRect: () => ({ top: 10, bottom: 110 }) }]
  const element = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, getBoundingClientRect: () => ({ top: 0 }), querySelectorAll: () => rows, contains: row => rows.includes(row) }
  follower.update(element, ['old'])
  element.scrollTop = 100; follower.scroll(element)
  rows[0].isConnected = false
  rows = []
  assert.deepEqual(follower.update(element, []), { following: false, unread: 0 })
  rows = [{ isConnected: true, getBoundingClientRect: () => ({ top: 20, bottom: 120 }) }]
  assert.deepEqual(follower.update(element, ['replacement']), { following: false, unread: 1 })
  assert.equal(element.scrollTop, 100)
})
