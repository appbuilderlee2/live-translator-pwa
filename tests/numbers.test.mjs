import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numericValues, numericMismatch } from '../src/transcript.mjs'

test('Chinese numerals, mixed scales, ordinals, dates and percentages match equivalent English values', () => {
  for (const [en, zh] of [
    ['2.4 million US dollars', '兩百四十萬美元'],
    ['35 million', '三千五百萬'],
    ['24000', '2萬4千'],
    ['12000', '1.2萬'],
    ['25%', '百分之二十五'],
    ['25 basis points, not 25%', '二十五個基點，不是百分之二十五'],
    ['June 15th', '六月十五日'],
    ['June fifteenth', '6月15日'],
    ['fifteenth', '十五'],
    ['the second', '第二'],
    ['I finished in 1st place.', '我獲得了第一名。'],
    ['the second place', '第二名'],
    ['I need 1 round-trip ticket and a 1-way ticket to Taipei.', '我需要一張來回票和一張去台北的單程票。'],
    ['1 item and 2 tickets', '一個物品和兩張票'],
    ['The subway leaves at 6:30', '地鐵6點30分出發'],
    ['9:30 am', '上午九點三十分'],
    ['twelve point five million to thirteen point two million', '一千二百五十萬至一千三百二十萬'],
    ['two point four million', '二百四十萬'],
    ['one hundred and ten percent', '百分之一百一十'],
    ['US$2.4M and US$12.5M', '２４０萬美元及１２５０萬美元'],
    ['2,400,000', '二百四十萬'],
    ['2026 and 205', '二〇二六與兩百零五'],
    ['123456789', '一億二千三百四十五萬六千七百八十九'],
    ['1 billion', '十億'],
    ['one and two', '一和二']
  ]) assert.equal(numericMismatch(en, zh), false, `${en} → ${zh}: ${numericValues(en)} / ${numericValues(zh)}`)
  assert.deepEqual(numericValues('twelve point five'), [12.5])
  assert.deepEqual(numericValues('第十二，〇，零，兩，两'), [12, 0, 0, 2, 2])
  assert.deepEqual(numericValues(''), [])
  assert.deepEqual(numericValues('No figures / 沒有數字'), [])
})

test('real Chinese numeral mismatches, missing figures and repeated values remain flagged', () => {
  for (const [en, zh] of [
    ['2.4 million', '四百萬'],
    ['twelve point five million', '兩千五百萬'],
    ['above 110%', '百分之一百左右'],
    ['June fifteenth', '六月五日'],
    ['2萬4千', '二萬五千'],
    ['25 and 25', '二十五'],
    ['13.2 million', ''],
    ['the second', '第三']
  ]) assert.equal(numericMismatch(en, zh), true, `${en} → ${zh}`)
})
