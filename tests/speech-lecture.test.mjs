import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSpeechController } from '../src/speech.mjs'

const normalize = text => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const segments = []; let id = 0
  const rec = { starts: 0, stops: 0, start() { this.starts++ }, stop() { this.stops++ }, abort() { throw new Error('Must not abort') } }
  const controller = createSpeechController(rec, {
    commit(text, meta) { const key = id++; segments.push({ id: key, text, ...meta }); return key },
    revise(key, text, meta) { const index = segments.findIndex(s => s.id === key); if (!text) segments.splice(index, 1); else Object.assign(segments[index], { text, ...meta }) },
    preview() {}, state() {}, message() {}
  })
  const emit = rows => rec.onresult({ resultIndex: 0, results: rows.map(({ text, final = false, confidence = .01 }) => Object.assign([{ transcript: text, confidence }], { isFinal: final })) })
  controller.start(); t.after(() => controller.dispose())
  return { rec, controller, segments, emit, text: () => segments.map(s => s.text).join(' ') }
}

test('60 second lecture: growing/repartitioned results, corrected prefixes and late finals lose no words', t => {
  const h = harness(t); const finals = []; const expected = []
  for (let turn = 0; turn < 6; turn++) {
    const sentence = `Lecture ${turn} discusses the budget of 2.4 million dollars. The entire team will review every important decision before approving the final project.`
    const tokens = sentence.split(' ')
    for (let step = 1; step <= 8; step++) {
      const partial = tokens.slice(0, Math.ceil(tokens.length * step / 8)).join(' ').replace('budget', 'bucket').replace(/project\.$/, 'projec')
      const split = partial.indexOf(' dollars.')
      h.emit([...finals, ...(split > 0 ? [{ text: partial.slice(0, split) }, { text: partial.slice(split) }] : [{ text: partial }])])
      t.mock.timers.tick(1000)
    }
    t.mock.timers.tick(1500)
    assert.ok(h.segments.some(s => s.provisional && s.confidence === undefined))
    finals.push({ text: sentence, final: true, confidence: .97 }); expected.push(sentence)
    h.emit(finals)
    t.mock.timers.tick(500)
  }
  assert.equal(normalize(h.text()), normalize(expected.join(' ')))
  assert.ok(h.segments.every(s => !s.provisional && s.confidence === .97))
  assert.equal(h.rec.stops, 0)
  assert.equal(h.rec.starts, 1)
  h.emit([...finals, { text: 'A final decision needs care' }])
  h.rec.onend(); assert.equal(h.rec.starts, 2)
  t.mock.timers.tick(100)
  h.emit([...finals, { text: 'A final decision needs careful review.', final: true, confidence: .98 }])
  t.mock.timers.tick(500)
  assert.equal(normalize(h.text()), normalize([...expected, 'A final decision needs careful review.'].join(' ')))
  assert.equal(h.rec.stops, 0)
})

test('tester event log replay preserves every final and the last unfinished result without forced stops', t => {
  const h = harness(t)
  const events = readFileSync(new URL('./speech-events.jsonl', import.meta.url), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const expected = []; let latest = ''; let time = Date.parse(events[0].timestamp)
  for (const event of events) {
    const now = Date.parse(event.timestamp); t.mock.timers.tick(now - time); time = now
    if (event.type === 'result') { latest = event.results.map(r => r.text.trim()).join(' '); h.emit(event.results) }
    else if (event.type === 'end') { expected.push(latest); latest = ''; h.rec.onend() }
    else if (event.type === 'start') h.rec.onstart()
    else if (event.type === 'error') h.rec.onerror({ error: event.error })
  }
  t.mock.timers.tick(250)
  assert.equal(normalize(h.text()), normalize(expected.join(' ')))
  assert.equal(h.rec.stops, 0)
  assert.ok(h.segments.filter(s => s.provisional).every(s => s.confidence === undefined))
})

test('shorter corrected finals replace provisional text in place and empty results do not create captions', t => {
  const h = harness(t)
  h.emit([{ text: '' }]); t.mock.timers.tick(1500); assert.equal(h.segments.length, 0)
  h.emit([{ text: 'We should probably probably approve the blue project.' }]); t.mock.timers.tick(1500)
  const id = h.segments[0].id
  h.emit([{ text: 'We should approve the new project.', final: true, confidence: .9 }])
  assert.equal(h.text(), 'We should approve the new project.')
  assert.equal(h.segments[0].id, id)
  assert.equal(h.rec.stops, 0)
})

test('published provisional prefixes never flip or shrink on subsequent interim revisions', t => {
  const h = harness(t)
  h.emit([{ text: 'The budget is 2.4 million and the team has approved the complete project.' }]); t.mock.timers.tick(1500)
  const text = h.text()
  h.emit([{ text: 'The budget' }]); t.mock.timers.tick(1500)
  assert.equal(h.text(), text)
  h.emit([{ text: 'A new draft has fewer words' }]); t.mock.timers.tick(1500)
  assert.equal(h.text(), text)
  h.emit([{ text: 'The budget is four million.', final: true, confidence: .99 }])
  assert.equal(h.text(), 'The budget is four million.')
  assert.equal(h.rec.stops, 0)
})

test('recognition number warnings cover alternatives even with high final confidence', t => {
  const h = harness(t)
  const result = Object.assign([{ transcript: 'The budget is 2.4 million.', confidence: .99 }, { transcript: 'The budget is 4 million.', confidence: .98 }], { isFinal: true })
  h.rec.onresult({ resultIndex: 0, results: [result] })
  assert.ok(h.segments[0].numericWarnings.includes('alternatives'))
})

test('recognition number warnings cover changed and missing interim figures', t => {
  const h = harness(t)
  h.emit([{ text: 'The budget is two point four million.' }]); t.mock.timers.tick(1500)
  h.emit([{ text: 'The budget is 4 million.', final: true, confidence: .99 }])
  assert.ok(h.segments[0].numericWarnings.includes('interim'))
  h.emit([{ text: 'The budget is 4 million.', final: true }, { text: 'Move the launch to August nineteenth.' }]); t.mock.timers.tick(1500)
  h.emit([{ text: 'The budget is 4 million.', final: true }, { text: 'Move the launch.', final: true, confidence: .99 }])
  assert.ok(h.segments.at(-1).numericWarnings.includes('interim'))
})

test('numbers retained across an end/late-final boundary are flagged; unchanged uninterrupted numbers are not', t => {
  const h = harness(t)
  h.emit([{ text: 'The budget is 2.4 million.' }]); t.mock.timers.tick(1500)
  h.emit([{ text: 'The budget is 2.4 million.', final: true, confidence: .99 }])
  assert.deepEqual(h.segments[0].numericWarnings, [])
  h.emit([{ text: 'The budget is 2.4 million.', final: true }, { text: 'The target is 110 percent.' }])
  h.rec.onend(); t.mock.timers.tick(100)
  h.emit([{ text: 'The budget is 2.4 million.', final: true }, { text: 'The target is 110 percent.', final: true, confidence: .99 }])
  assert.ok(h.segments.at(-1).numericWarnings.includes('boundary'))
  assert.equal(h.rec.stops, 0)
})

test('quick traveler turns complete the existing short caption instead of splitting price or duplicating phone', t => {
  const h = harness(t); const finals = []
  const turns = [['The subway leaves', 'The subway leaves at 6:30'], ['The ticket costs', 'The ticket costs $25'], ['Can I pay with my mobile phone', 'Can I pay with my mobile phone?']]
  for (const [interim, final] of turns) {
    h.emit([...finals, { text: interim }]); t.mock.timers.tick(1500)
    h.emit([...finals, { text: interim.split(' ').at(-1) }]); t.mock.timers.tick(1500)
    finals.push({ text: final, final: true, confidence: .99 }); h.emit(finals)
  }
  assert.deepEqual(h.segments.map(s => s.text), turns.map(([, final]) => final))
  assert.equal(h.rec.stops, 0)
  assert.equal(h.rec.starts, 1)
})
