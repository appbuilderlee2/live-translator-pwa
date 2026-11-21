import { normalizeBusiness, currencySource, protectCurrency } from '../shared/business.mjs'
import { normalizeMedical, medicalTranslation, medicalWarnings } from '../shared/medical.mjs'
import { negationMismatch } from '../shared/negation.mjs'
import { createLimiter, withTimeout } from '../shared/retry.mjs'
import { semanticMismatch } from '../shared/coverage.mjs'
import { traditional } from '../shared/traditional.mjs'
import { speechClauses, readableChinese } from '../shared/phrasing.mjs'
import { numericMismatch, splitText } from './transcript.mjs'
import { networkTranslation } from './network.mjs'

export function coverageMismatch(source, translated) {
  if (semanticMismatch(source, translated)) return true
  if (!translated.trim() || numericMismatch(source, translated)) return true
  const words = source.match(/[a-z]+(?:['’][a-z]+)?/gi)?.length || 0
  const letters = translated.match(/[\p{L}\p{N}]/gu)?.length || 0
  if (/\bTaipei\b|臺北|台北/i.test(source) && !/臺北|台北|\bTaipei\b/i.test(translated)) return true
  if (/(?:臺北|台北).*捷運站|Taipei (?:subway|metro) station/i.test(source) && !/捷運站|地鐵站|地铁站|MRT station/i.test(translated)) return true
  return words >= 8 && letters < words * .65 || words >= 5 && letters < 2
}

export function localChunks(text) {
  return speechClauses(text).flatMap(clause => splitText(clause, 120)).filter(chunk => chunk.trim())
}

const localLimited = createLimiter(1)
export async function localTranslation(local, text, signal, context = [], options = {}) {
  if (options.preview) throw Object.assign(new Error('Translation previews disabled'), { retryable: false, code: 'previews_disabled' })
  return localLimited(() => translateChunks(local, text, signal, context, options), { signal })
}

async function translateChunks(local, text, signal, context, options) {
  const currency = protectCurrency(normalizeBusiness(currencySource(text, options.spoken), context))
  const source = normalizeMedical(currency.text, context)
  const translated = []
  const chunks = localChunks(source)
  for (const [index, chunk] of chunks.entries()) {
    const result = traditional(await withTimeout(attemptSignal => local.translate(chunk, { signal: attemptSignal }), { signal, timeout: options.preview ? 1200 : 2500 }))
    if (coverageMismatch(chunk, result)) throw new Error('On-device translation may be incomplete')
    const boundary = /[.!?;]$/.test(chunk.trim()) || index + 1 < chunks.length && speechClauses(`${chunk} ${chunks[index + 1]}`).length > 1
    translated.push(chunks.length > 1 && boundary && /[\p{Script=Han}\d]$/u.test(result) ? `${result}。` : result)
  }
  const result = medicalTranslation(text, traditional(currency.restore(translated.join(' ')), text), context)
  if (coverageMismatch(text, result) || negationMismatch(text, result) || medicalWarnings(text, result, context).length) throw new Error('On-device translation did not preserve meaning')
  return readableChinese(text, result)
}

export async function translateWithFallback(local, text, signal, update, context = [], options = {}, fallback = networkTranslation) {
  signal.throwIfAborted()
  if (options.preview) throw Object.assign(new Error('Translation previews disabled'), { retryable: false, code: 'previews_disabled' })
  if (local) {
    try {
      const result = await localTranslation(local, text, signal, context, options)
      signal.throwIfAborted(); update(result); return result
    } catch { signal.throwIfAborted() }
  }
  return fallback(text, signal, update, context, options)
}
