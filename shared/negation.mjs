import { numericPrefix, numericValues } from './numbers.mjs'

const englishNegation = /\b(?:not|never|no|without|neither|nor|cannot|\w+n['’]t)\b/gi

export function negationMismatch(en, zh) {
  const negatives = [...en.matchAll(englishNegation)]
  if (!negatives.length) return false
  if (negatives.length > [...zh.matchAll(/[不沒没未非別别無无勿莫]/g)].length) return true
  const exclusions = [...zh.matchAll(/(?:不是|並非|而非|非|不等於|不為|不含|不包括|不(?=\s*[\d零〇一二三四五六七八九兩两十百千萬億]))([^，。,;；!?]*)/g)]
  return negatives.some(match => {
    if (!/^(?:not|no)$/i.test(match[0])) return false
    const value = numericValues(numericPrefix(en.slice(match.index + match[0].length).trimStart()))[0]
    return value !== undefined && !exclusions.some(clause => numericValues(clause[1])[0] === value)
  })
}

export function normalizeNegations(input) {
  let text = input.replace(/\b(\w+)n['’]t\b/gi, (_all, stem) => `${({ ca: 'can', wo: 'will', sha: 'shall' })[stem.toLowerCase()] || stem} not`)
  for (const match of [...text.matchAll(/\bnot\s+/gi)].reverse()) {
    const start = match.index + match[0].length
    const amount = numericPrefix(text.slice(start))
    if (!amount) continue
    const before = text.slice(0, match.index).trimEnd()
    const after = text.slice(start + amount.length)
    text = `${before}${before && !/[.,;!?]$/.test(before) ? ',' : ''}${before ? ' ' : ''}not ${amount}${after && !/^\s*[.,;!?]/.test(after) ? '. ' + after.trimStart() : after}`
  }
  return text
}
