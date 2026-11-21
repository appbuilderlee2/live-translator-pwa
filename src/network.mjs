import { retryAfter, withTimeout } from '../shared/retry.mjs'
import { traditional } from '../shared/traditional.mjs'
import { negationMismatch } from '../shared/negation.mjs'
import { medicalTranslation, medicalWarnings } from '../shared/medical.mjs'

export async function networkTranslation(text, signal, update, context = [], options = {}) {
    if (options.preview) throw Object.assign(new Error('Server previews disabled'), { retryable: false, code: 'previews_disabled' })
    const response = await withTimeout(attemptSignal => fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, context, ...options }), signal: attemptSignal }), { signal, timeout: options.preview ? 1500 : 7500 })
    if (!response.ok || !response.body) {
      const error = new Error('翻譯暫時無法使用，請按「重新翻譯」。Translation unavailable. Tap Retry translation to try again.')
      error.retryable = response.status === 408 || response.status === 429 || response.status >= 500
      error.retryAfter = retryAfter(response.headers.get('Retry-After'), Date.now(), 86400000)
      error.status = response.status
      try { error.code = (await withTimeout(() => response.json(), { signal, timeout: 1000 })).error } catch { error.code = 'upstream_error' }
      throw error
    }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let result = ''
    try {
      while (true) {
        const { done, value } = await withTimeout(() => reader.read(), { signal, timeout: options.preview ? 1500 : 4500 })
        result += decoder.decode(value, { stream: !done }); signal.throwIfAborted()
        if (result) update(medicalTranslation(text, traditional(result), context))
        if (done) break
      }
    } catch (error) { void reader.cancel(error).catch(() => {}); throw error } finally { reader.releaseLock() }
    if (!result.trim()) throw Object.assign(new Error('未收到譯文，請重新翻譯。No translation received. Please retry.'), { code: 'translation_invalid' })
    if (negationMismatch(text, traditional(result))) throw Object.assign(new Error('否定詞可能遺漏或範圍不符 / Negation may be missing or misplaced'), { code: 'translation_invalid' })
    if (medicalWarnings(text, traditional(result), context).length) throw Object.assign(new Error('醫療用語可能誤譯 / Medical meaning may be mistranslated'), { code: 'translation_invalid' })
    return medicalTranslation(text, traditional(result), context)
}
