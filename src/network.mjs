import { retry } from '../shared/retry.mjs'
import { traditional } from '../shared/traditional.mjs'

export async function networkTranslation(text, signal, update, context = []) {
  return retry(async () => {
    const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, context }), signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) })
    if (!response.ok || !response.body) {
      const error = new Error('翻譯暫時無法使用，請按「重新翻譯」。Translation unavailable. Tap Retry translation to try again.')
      error.retryable = response.status === 408 || response.status === 429 || response.status >= 500
      throw error
    }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let result = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        result += decoder.decode(value, { stream: !done }); signal.throwIfAborted()
        if (result) update(traditional(result))
        if (done) break
      }
    } finally { reader.releaseLock() }
    if (!result.trim()) throw new Error('未收到譯文，請重新翻譯。No translation received. Please retry.')
    return traditional(result)
  }, { signal, attempts: 2, delay: 300 })
}
