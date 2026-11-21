import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTranslationRecovery } from '../src/recovery.mjs'

test('interrupted translations retry automatically with backoff, keep latest text, and stop after success', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let segment = { id: 'x', en: 'original', status: 'error' }
  const calls = []
  const recovery = createTranslationRecovery({ find: () => segment, retry: s => calls.push(s.en), online: () => true })
  t.after(() => recovery.dispose())
  recovery.failed('x'); recovery.failed('x')
  t.mock.timers.tick(999); assert.deepEqual(calls, [])
  segment.en = 'revised'; t.mock.timers.tick(1); assert.deepEqual(calls, ['revised'])
  recovery.begin('x'); recovery.failed('x')
  t.mock.timers.tick(1999); assert.equal(calls.length, 1)
  t.mock.timers.tick(1); assert.equal(calls.length, 2)
  recovery.failed('x'); recovery.succeeded('x')
  t.mock.timers.tick(60000); assert.equal(calls.length, 2)
})

test('removed, offline or already translating segments do not retry; disposal cancels timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let segment; let online = true; let count = 0
  const recovery = createTranslationRecovery({ find: () => segment, retry: () => count++, online: () => online })
  recovery.failed('gone'); t.mock.timers.tick(1000); assert.equal(count, 0)
  segment = { status: 'error' }; online = false
  recovery.failed('offline'); t.mock.timers.tick(1000); assert.equal(count, 0)
  online = true; recovery.failed('offline'); t.mock.timers.tick(2000); assert.equal(count, 1)
  segment.status = 'translating'; recovery.failed('busy'); t.mock.timers.tick(1000); assert.equal(count, 1)
  recovery.failed('disposed'); recovery.dispose(); t.mock.timers.tick(60000); assert.equal(count, 1)
})
