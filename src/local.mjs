import { normalizeBusiness, currencySource, protectCurrency } from '../shared/business.mjs'
import { normalizeMedical, medicalTranslation, medicalWarnings } from '../shared/medical.mjs'
import { negationMismatch } from '../shared/negation.mjs'
import { withTimeout } from '../shared/retry.mjs'
import { traditional } from '../shared/traditional.mjs'
import { numericMismatch, splitText } from './transcript.mjs'
import { networkTranslation } from './network.mjs'

export function coverageMismatch(source, translated) {
  if (!translated.trim() || numericMismatch(source, translated)) return true
  const words = source.match(/[a-z]+(?:['’][a-z]+)?/gi)?.length || 0
  const letters = translated.match(/[\p{L}\p{N}]/gu)?.length || 0
  if (/\bTaipei\b|臺北|台北/i.test(source) && !/臺北|台北|\bTaipei\b/i.test(translated)) return true
  if (/(?:臺北|台北).*捷運站|Taipei (?:subway|metro) station/i.test(source) && !/捷運站|地鐵站|地铁站|MRT station/i.test(translated)) return true
  return words >= 8 && letters < words * .65 || words >= 5 && letters < 2
}

export function localChunks(text) {
  return text.split(/(?<=[.!?;])\s+|(?=\b(?:please|thank you|we need|do not|don't)\b)/i).flatMap(clause => splitText(clause, 120))
}

export async function localTranslation(local, text, signal, context = [], options = {}) {
  const currency = protectCurrency(normalizeBusiness(currencySource(text, options.spoken), context))
  const source = normalizeMedical(currency.text, context)
  const translated = []
  for (const chunk of localChunks(source)) {
    const result = traditional(await withTimeout(() => local.translate(chunk), { signal, timeout: options.preview ? 1200 : 2500 }))
    if (coverageMismatch(chunk, result)) throw new Error('On-device translation may be incomplete')
    translated.push(result)
  }
  const result = medicalTranslation(text, traditional(currency.restore(translated.join(' '))), context)
  if (coverageMismatch(text, result) || negationMismatch(text, result) || medicalWarnings(text, result, context).length) throw new Error('On-device translation did not preserve meaning')
  return result
}

export async function translateWithFallback(local, text, signal, update, context = [], options = {}, fallback = networkTranslation) {
  signal.throwIfAborted()
  if (local) {
    try {
      const result = await localTranslation(local, text, signal, context, options)
      signal.throwIfAborted(); update(result); return result
    } catch { signal.throwIfAborted() }
  }
  return fallback(text, signal, update, context, options)
}
