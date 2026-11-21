import { numericPrefix, numericValues } from './numbers.mjs'

const medicine = /\b(?:medicine|medication|doctor|pharmacist|dose|dosage|pills?|blood pressure)\b|\b(?:take|swallow)\b[^.!?]*\btablets?\b/i
const textWithContext = (text, context) => [...context.map(item => item.en), text].join(' ')
function medicinalTablets(text, context) {
  return /\b(?:pills?|tablets?)\b/i.test(text) && medicine.test(textWithContext(text, context)) && !/\b(?:tablet computer|tablet device|iPad|Android)\b/i.test(text)
}
function medicineClassifiers(text) {
  const counts = new Map()
  for (const match of text.matchAll(/\b(?:(kinds?|types?|sorts?)\s+of\s+)?(?:medicine\s+)?(?:tablets?|pills?|capsules?)\b/gi)) {
    if (/^\s+(?:computers?|devices?)\b/i.test(text.slice(match.index + match[0].length))) continue
    const before = text.slice(0, match.index).trimEnd()
    for (const start of before.matchAll(/\b(?=\d|[a-z])/gi)) {
      const number = before.slice(start.index)
      if (numericPrefix(number).trim() !== number) continue
      const values = numericValues(number)
      if (values.length !== 1) continue
      const classifiers = counts.get(values[0]) || new Set()
      classifiers.add(match[1] ? '種' : '顆')
      counts.set(values[0], classifiers)
      break
    }
  }
  return counts
}
function pressureReadings(text, context) {
  if (!/\bblood pressure\b/i.test(textWithContext(text, context))) return []
  const readings = []
  for (const over of text.matchAll(/\bover\s+/gi)) {
    const before = text.slice(0, over.index).trimEnd()
    const right = numericPrefix(text.slice(over.index + over[0].length)).trim()
    if (!right) continue
    for (const start of before.matchAll(/\b(?=\d|[a-z])/gi)) {
      const left = before.slice(start.index)
      if (numericPrefix(left).trim() !== left) continue
      if (/[\d]$/.test(left) || /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b$/i.test(left)) {
        const values = [numericValues(left)[0], numericValues(right)[0]]
        if (values.every(Number.isFinite) && !/[$€£%]|million|billion|dollars?|percent/i.test(left + right)) readings.push({ start: start.index, end: over.index + over[0].length + right.length, values })
        break
      }
    }
  }
  return readings
}

export function normalizeMedical(text, context = []) {
  const readings = pressureReadings(text, context)
  for (const reading of readings.reverse()) text = text.slice(0, reading.start) + reading.values.join('/') + text.slice(reading.end)
  if (medicinalTablets(text, context)) text = text.replace(/\btablets?\b/gi, word => /s$/i.test(word) ? 'medicine pills' : 'medicine pill')
  return text.replace(/\bcheck (?:the |my |your )?(?:medicine )?label with (?:the |a |my |your )?pharmacist\b/gi, 'ask the pharmacist to help check the medicine label')
}

export function medicalWarnings(text, translated, context = []) {
  const warnings = []
  if (medicinalTablets(text, context) && /平板(?:電腦|电脑|計算機|计算机)/.test(translated)) warnings.push('藥品可能誤譯為電腦 / medicine may be mistranslated as a computer')
  if (pressureReadings(text, context).length && /[\d零〇一二三四五六七八九兩两十百]\s*(?:超過|超过|大於|大于|高於|高于)\s*[\d零〇一二三四五六七八九兩两十百]/.test(translated)) warnings.push('血壓讀值可能誤譯為比較 / blood-pressure reading may be mistranslated as a comparison')
  if (/\bcheck\b[^.!?]*\blabel\b[^.!?]*\bpharmacist\b/i.test(text) && /藥[劑剂]?師標[籤签]/.test(translated)) warnings.push('請核對藥師確認標示的指示 / check the instruction to confirm the label with the pharmacist')
  return warnings
}

export function medicalTranslation(text, translated, context = []) {
  if (medicinalTablets(text, context)) translated = translated.replace(/平板(?:電腦|电脑|計算機|计算机)|藥丸|藥物片劑|片劑/g, '藥錠')
  const classifiers = medicineClassifiers(text)
  translated = translated.replace(/([\d零〇一二三四五六七八九兩两十百千萬億]+(?:[.點][\d零〇一二三四五六七八九兩两]+)?)\s*(?:種類|種|個|片|粒|顆|塊|枚)?\s*(藥錠|藥片|藥丸|膠囊)/g, (match, number, noun) => {
    const choices = classifiers.get(numericValues(number)[0])
    return choices?.size === 1 ? `${number === '二' ? '兩' : number}${[...choices][0]}${noun}` : match
  })
  for (const { values: [systolic, diastolic] } of pressureReadings(text, context)) {
    const number = value => String(value).replace(/\./g, '\\.')
    translated = translated.replace(new RegExp(`(?<![\\d.])${number(systolic)}\\s*(?:超過|超过|大於|大于|高於|高于)\\s*${number(diastolic)}(?![\\d.])`, 'g'), `${systolic}/${diastolic}`)
  }
  if (/\bcheck\b[^.!?]*\blabel\b[^.!?]*\bpharmacist\b/i.test(text)) translated = translated.replace(/請諮詢藥(?:劑)?師標籤/g, '請藥師協助確認藥品標示')
  return translated
}

export function protectMedical(text, context = []) {
  const normalized = normalizeMedical(text, context)
  const protectedText = normalized.replace(/\bmedicine pills?\b/gi, '__MEDICINE_TABLET__')
  return { text: protectedText, restore(result) {
    if (protectedText !== normalized && !/__\s*MEDICINE\s*_\s*TABLET\s*__/i.test(result)) throw new Error('Medicine placeholder was lost')
    return result.replace(/__\s*MEDICINE\s*_\s*TABLET\s*__/gi, '藥錠')
  } }
}

export const medicalPrompt = `Use medical context from the current and previous segments. Medicinal tablets/pills are 藥錠 or 藥片, never 平板電腦; a tablet computer remains a computer. Count tablets, pills and capsules with 顆, not 種; use 種 only for explicit kinds/types of medicine. A blood-pressure reading X over Y means X/Y (收縮壓 X、舒張壓 Y), never X 超過 Y. Preserve dosage, frequency, time limits, symptoms and negation exactly: one tablet twice daily after meals is 飯後每次一顆、一天兩次; no more than two tablets in 24 hours is 24 小時內不可超過兩顆. Check the label with the pharmacist before taking medicine means 用藥前請藥師協助確認藥品標示. Do not add diagnoses or medical advice. Use 公車, 社區健走活動, 紙本說明, and 拿給家庭醫師看 for the corresponding everyday Taiwan expressions.`
