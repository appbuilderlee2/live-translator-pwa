import { test } from 'node:test'
import assert from 'node:assert/strict'
import { traditional } from '../shared/traditional.mjs'
import { medicalTranslation } from '../shared/medical.mjs'
import { readableChinese } from '../shared/phrasing.mjs'
import { createSpeechController } from '../src/speech.mjs'

test('elderly medication passage separates all four instructions and removes medicine-count spaces', () => {
  const source = 'Take one tablet twice a day after meals. Do not take more than two tablets in twenty-four hours. Please check the label with the pharmacist before taking this medicine. I want to make sure that I understand the correct dose.'
  const raw = '每天兩次，飯後服用一顆 藥錠 24 小時內不要服用超過兩顆 藥錠 服用此藥前請諮詢藥師幫助檢查藥品標籤 我想確保我瞭解正確的劑量。'
  const expected = '每天兩次，飯後服用一顆藥錠。24 小時內不要服用超過兩顆藥錠。服用此藥前請諮詢藥師幫助檢查藥品標籤。我想確保我瞭解正確的劑量。'
  assert.equal(readableChinese(source, medicalTranslation(source, traditional(raw, source))), expected)
  assert.equal(readableChinese(source, expected), expected)
  assert.equal(readableChinese(source, ''), '')
})

test('physical community centre and walking activity use Taiwan wording without rewriting online communities or walking routes', () => {
  const source = 'After the appointment we will go to the community centre to meet our friends and ask about the walking activity next week before taking the bus home together.'
  assert.equal(traditional('我們將前往社群中心，詢問下週的步行活動。', source), '我們將前往社區活動中心，詢問下週的健走活動。')
  assert.equal(traditional('社群中心提供資訊。', 'The online community centre provides information.'), '社群中心提供資訊。')
  assert.equal(traditional('請顯示步行路線。', 'Please show the walking route.'), '請顯示步行路線。')
  assert.equal(traditional('', source), '')
})

test('an orphan politeness sentence joins the following instruction, not a quoted noun', () => {
  assert.equal(readableChinese('Please meet me at the station.', '請。 在車站接我。'), '請在車站接我。')
  assert.equal(readableChinese('Please meet me at the station.', '我需要座位，請。在車站接我。'), '我需要座位，請在車站接我。')
  assert.equal(readableChinese('The word please.', '這個字是請。'), '這個字是請。')
})

for (const paused of [false, true]) test(`caption boundaries keep please with its following instruction, paused=${paused}`, t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const segments = []
  const rec = { start() {}, stop() {} }
  const controller = createSpeechController(rec, {
    commit(en, metadata) { segments.push({ en, ...metadata }); return segments.length - 1 },
    revise(id, en, metadata) { Object.assign(segments[id], { en, ...metadata }) }, preview() {}, state() {}, message() {}
  })
  t.after(() => controller.dispose())
  const text = `${Array(29).fill('word').join(' ')} please meet me at the Taipei metro station and bring a comfortable chair because my friend cannot stand for long`
  const emit = (text, isFinal) => rec.onresult({ results: [Object.assign([{ transcript: text, confidence: .99 }], { isFinal })] })
  controller.start()
  if (paused) { emit(text.split(' ').slice(0, 30).join(' '), false); t.mock.timers.tick(1200) }
  emit(text, true); t.mock.timers.tick(3000)
  assert.ok(segments.every(s => !/\bplease$/i.test(s.en)))
  assert.equal(segments.map(s => s.en).join(' '), text)
  assert.ok(segments.some(s => /\bplease meet\b/.test(s.en)))
})
