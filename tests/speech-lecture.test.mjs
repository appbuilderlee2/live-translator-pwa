import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSpeechController } from '../src/speech.mjs'

const normalize = text => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const segments = []; const previews = []; let id = 0
  const rec = { starts: 0, stops: 0, start() { this.starts++ }, stop() { this.stops++ }, abort() { throw new Error('Must not abort') } }
  const controller = createSpeechController(rec, {
    commit(text, meta) { const key = id++; segments.push({ id: key, text, ...meta }); return key },
    revise(key, text, meta) { const index = segments.findIndex(s => s.id === key); if (!text) segments.splice(index, 1); else Object.assign(segments[index], { text, ...meta }) },
    preview(text) { previews.push(text) }, state() {}, message() {}
  })
  const emit = (rows, resultIndex = 0) => rec.onresult({ resultIndex, results: rows.map(({ text, final = false, confidence = .01 }) => Object.assign([{ transcript: text, confidence }], { isFinal: final })) })
  controller.start(); t.after(() => controller.dispose())
  return { rec, controller, segments, previews, emit, text: () => segments.map(s => s.text).join(' ') }
}

for (const text of ['the', 'a', 'um', 'Uh.', 'and', 'can']) test(`filler-only interim is never published or sent for preview translation: ${text}`, async t => {
  const h = harness(t)
  h.emit([{ text }]); t.mock.timers.tick(4000)
  assert.deepEqual(h.segments, []); assert.ok(h.previews.every(text => !text))
  h.rec.onend(); t.mock.timers.tick(250); await h.controller.finish()
  assert.deepEqual(h.segments, [])
})

test('traveler v4 run 3: lone the before the phone question does not become a saved card', t => {
  const h = harness(t)
  h.emit([{ text: 'the' }]); t.mock.timers.tick(3804)
  h.emit([{ text: 'can' }]); t.mock.timers.tick(83)
  h.emit([{ text: 'can I' }]); t.mock.timers.tick(300)
  h.emit([{ text: 'can I pay with my' }]); t.mock.timers.tick(186)
  h.emit([{ text: 'can' }, { text: 'I pay with my' }]); t.mock.timers.tick(562)
  h.emit([{ text: 'can I pay with my' }, { text: 'mobile' }]); t.mock.timers.tick(665)
  h.emit([{ text: 'can I pay with my mobile phone', final: true, confidence: .95 }])
  t.mock.timers.tick(1500)
  assert.deepEqual(h.segments.map(s => s.text), ['can I pay with my mobile phone'])
  assert.equal(h.rec.stops, 0)
})

test('short meaningful interim and a complete refinement starting with a function word are preserved', async t => {
  const h = harness(t)
  h.emit([{ text: 'the' }]); t.mock.timers.tick(1500)
  h.emit([{ text: 'the station', final: true }])
  h.emit([{ text: 'the station', final: true }, { text: '$25' }]); await h.controller.finish()
  assert.deepEqual(h.segments.map(s => s.text), ['the station', '$25'])
})

test('first network error restarts immediately after end; repeats back off until results resume', t => {
  const h = harness(t)
  h.rec.onerror({ error: 'network' }); assert.equal(h.rec.starts, 1)
  h.rec.onend(); assert.equal(h.rec.starts, 2)
  h.rec.onstart(); h.rec.onerror({ error: 'network' }); h.rec.onend()
  t.mock.timers.tick(999); assert.equal(h.rec.starts, 2)
  t.mock.timers.tick(1); assert.equal(h.rec.starts, 3)
  h.emit([{ text: 'Recognition has recovered', final: true }])
  h.rec.onerror({ error: 'network' }); h.rec.onend(); assert.equal(h.rec.starts, 4)
  assert.equal(h.rec.stops, 0)
})

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

for (const published of [false, true]) test(`reused nonzero result index preserves an unrelated interim (${published ? 'published' : 'preview only'})`, t => {
  const h = harness(t)
  const subway = { text: 'The subway leaves at 6:30', final: true, confidence: .99 }
  const ticket = { text: 'The ticket costs $25' }
  const phone = { text: 'Can I pay with my mobile phone?', final: true, confidence: .98 }
  h.emit([subway, ticket])
  if (published) t.mock.timers.tick(1500)
  const ticketId = h.segments.find(s => s.text === ticket.text)?.id
  h.emit([subway, phone])
  assert.deepEqual(h.segments.map(s => s.text), [subway.text, ticket.text, phone.text])
  assert.equal(h.segments[1].provisional, true)
  assert.equal(h.segments[1].forced, true)
  assert.equal(h.segments[1].confidence, undefined)
  assert.ok(h.segments[1].numericWarnings.includes('interim'))
  assert.deepEqual(h.segments[2].numericWarnings, [])
  if (published) assert.equal(h.segments[1].id, ticketId)
  h.emit([subway, phone])
  h.emit([subway, phone, { text: 'Thank you.', final: true, confidence: .99 }])
  assert.deepEqual(h.segments.map(s => s.text), [subway.text, ticket.text, phone.text, 'Thank you.'])
  assert.equal(h.rec.stops, 0)
  assert.equal(h.rec.starts, 1)
})

test('same-index identical and extended prefixes refine a single caption in place', t => {
  const h = harness(t)
  h.emit([{ text: 'The ticket costs' }]); t.mock.timers.tick(1500)
  const id = h.segments[0].id
  h.emit([{ text: 'The ticket costs' }])
  h.emit([{ text: 'The ticket costs $25' }]); t.mock.timers.tick(1500)
  h.emit([{ text: 'The ticket costs $25.', final: true, confidence: .98 }])
  assert.equal(h.text(), 'The ticket costs $25.')
  assert.equal(h.segments.length, 1)
  assert.equal(h.segments[0].id, id)
  assert.equal(h.segments[0].provisional, false)
  assert.equal(h.segments[0].forced, false)
  assert.equal(h.rec.stops, 0)
})

test('a displaced refinement extends the published caption instead of orphaning its price', t => {
  const h = harness(t)
  h.emit([{ text: 'The ticket costs' }]); t.mock.timers.tick(1500)
  const id = h.segments[0].id
  h.emit([{ text: 'The ticket costs $25' }])
  h.emit([{ text: 'Can I pay with my mobile phone?', final: true, confidence: .98 }])
  assert.deepEqual(h.segments.map(s => s.text), ['The ticket costs $25', 'Can I pay with my mobile phone?'])
  assert.equal(h.segments[0].id, id)
  assert.ok(h.segments[0].numericWarnings.includes('interim'))
  assert.deepEqual(h.segments[1].numericWarnings, [])
})

test('empty result batches do not erase the interim before an index is reused', t => {
  const h = harness(t)
  h.emit([{ text: 'The ticket costs $25' }])
  h.emit([])
  h.emit([{ text: '' }])
  h.emit([{ text: 'Can I pay with my mobile phone?', final: true, confidence: .98 }])
  assert.deepEqual(h.segments.map(s => s.text), ['The ticket costs $25', 'Can I pay with my mobile phone?'])
  assert.equal(h.rec.stops, 0)
})

test('a numeric-only interim is retained when a result index is reused', t => {
  const h = harness(t)
  h.emit([{ text: '$25' }])
  h.emit([{ text: 'Can I pay with my mobile phone?', final: true, confidence: .98 }])
  assert.deepEqual(h.segments.map(s => s.text), ['$25', 'Can I pay with my mobile phone?'])
})

for (const interim of ['Turn left', 'The station']) test(`short unrelated nonnumeric interim is retained: ${interim}`, t => {
  const h = harness(t)
  h.emit([{ text: interim }])
  h.emit([{ text: 'The museum opens Sunday.', final: true, confidence: .98 }])
  assert.deepEqual(h.segments.map(s => s.text), [interim, 'The museum opens Sunday.'])
})

test('meeting index replacements retain budget and margin before ARR and retention finals', t => {
  const h = harness(t)
  const budget = 'The budget is 2.4 million US dollars, purple lantern.'
  const arr = { text: 's from 12.5 million to 13.2 million US dollars not 30.2 million keep the forecast', final: true, confidence: .96 }
  const margin = 'Gross margin fell by 25 basis points, not 25 percent.'
  const retention = { text: 'Move the go-live to August 19; keep net revenue retention above 110%.', final: true, confidence: .95 }
  h.emit([{ text: budget }]); t.mock.timers.tick(1500)
  h.emit([arr])
  h.emit([arr, { text: margin }]); t.mock.timers.tick(1500)
  h.emit([arr, retention])
  h.emit([arr, retention])
  assert.deepEqual(h.segments.map(s => s.text), [budget, arr.text, margin, retention.text])
  assert.equal(h.rec.stops, 0)
})

const travelerEvents = readFileSync(new URL('./traveler-v3-speech.jsonl', import.meta.url), 'utf8').trim().split('\n').map(line => JSON.parse(line))
const playbacks = travelerEvents.flatMap((event, index) => event.kind === 'mark' && /playback begin/.test(event.name) ? [{ index, name: event.name }] : [])
for (const [index, playback] of playbacks.entries()) test(`actual traveler v3 JSONL: ${playback.name}`, t => {
  const h = harness(t)
  const events = travelerEvents.slice(playback.index, playbacks[index + 1]?.index)
  let rows = []; let time = Date.parse(events[0].t)
  for (const event of events) {
    const now = Date.parse(event.t); t.mock.timers.tick(now - time); time = now
    if (event.kind === 'result') {
      rows = [...rows.slice(0, event.index), ...event.results]
      h.emit(rows, event.index)
    } else if (event.kind === 'end') { h.rec.onend(); rows = [] }
    else if (event.kind === 'start') h.rec.onstart()
    else if (event.kind === 'error') h.rec.onerror({ error: event.error })
    else if (event.kind === 'call:stop') h.controller.stop()
  }
  t.mock.timers.tick(1500)
  if (!playback.name.startsWith('rapid')) {
    assert.deepEqual(h.segments.map(s => s.text), [
      'excuse me where can I buy a train ticket',
      'is the museum open tomorrow morning',
      'thank you I would like a cup of green tea'
    ])
    return
  }
  const ticket = h.segments.filter(s => /ticket costs \$25/i.test(s.text))
  const phone = h.segments.filter(s => /can I pay with my mobile phone/i.test(s.text))
  assert.equal(ticket.length, 1, JSON.stringify(h.segments))
  assert.equal(phone.length, 1, JSON.stringify(h.segments))
  assert.notEqual(ticket[0].id, phone[0].id)
  assert.equal(h.segments.length, 3, JSON.stringify(h.segments))
  assert.deepEqual(h.segments.map(s => s.text), ['the subway leaves at 6:30', 'the ticket costs $25', 'can I pay with my mobile phone'])
  assert.ok(ticket[0].numericWarnings.includes('interim'))
  assert.deepEqual(phone[0].numericWarnings, [])
  assert.equal(ticket[0].confidence, undefined)
})
