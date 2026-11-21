import { meetingPrompt, normalizeBusiness, protectNames, protectCurrency } from './business.mjs'
import { traditional, translationBuffer } from './traditional.mjs'
import { createLimiter, retry } from './retry.mjs'

const limited = createLimiter(2)
const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
async function upstream(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) })
  if (!response.ok) {
    await response.body?.cancel()
    const error = new Error('Translation provider unavailable')
    error.retryable = response.status === 408 || response.status === 429 || response.status >= 500
    throw error
  }
  return response
}
export async function translateHandler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
  let text; let context
  try {
    const body = await req.json()
    text = body?.text
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error()
    text = text.trim()
    if (body.context !== undefined && (!Array.isArray(body.context) || body.context.length > 2 || body.context.some(s => !s || typeof s.en !== 'string' || typeof s.zh !== 'string' || s.en.length > 2000 || s.zh.length > 8000))) throw new Error()
    context = body.context || []
  } catch { return new Response('Provide text between 1 and 2000 characters and at most two context segments.', { status: 400 }) }
  const env = typeof process !== 'undefined' ? process.env : {}
  try {
    if (!env.OPENAI_API_KEY) {
      const currency = protectCurrency(normalizeBusiness(text))
      const protectedText = protectNames(currency.text)
      const result = await limited(() => retry(async () => {
        const response = await upstream(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${encodeURIComponent(protectedText.text)}`, { signal: req.signal })
        const data = await response.json()
        const result = data[0].map(part => part[0] || '').join('')
        if (!result.trim()) throw new Error('Empty translation')
        return traditional(currency.restore(protectedText.restore(result)))
      }, { signal: req.signal }))
      return new Response(result, { headers })
    }
    const messages = [{ role: 'system', content: meetingPrompt }]
    if (context.length) messages.push({ role: 'user', content: `Previous committed segments (context only):\n${JSON.stringify(context)}` }, { role: 'assistant', content: 'I will use these only for terminology consistency.' })
    messages.push({ role: 'user', content: text })
    const response = await limited(() => retry(() => upstream('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: req.signal, headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-4o-mini', stream: true, messages }) }), { signal: req.signal }))
    if (!response.body) throw new Error('Missing stream')
    const reader = response.body.getReader(); const decoder = new TextDecoder(); const encoder = new TextEncoder()
    let buffer = ''; let received = false; let completed = false
    const stream = new ReadableStream({
      async start(controller) {
        const output = translationBuffer(text => { if (text) { received = true; controller.enqueue(encoder.encode(text)) } })
        const line = value => {
          if (!value.startsWith('data: ')) return
          const payload = value.slice(6).trim()
          if (payload === '[DONE]') { completed = true; return }
          const event = JSON.parse(payload)
          if (event.error) throw new Error('Provider stream failed')
          const delta = event.choices?.[0]?.delta?.content
          if (delta) output.push(delta)
        }
        try {
          while (true) {
            const { value, done } = await reader.read()
            buffer += decoder.decode(value, { stream: !done })
            const lines = buffer.split('\n'); buffer = lines.pop() || ''
            for (const value of lines) line(value)
            if (done) break
          }
          if (buffer) line(buffer)
          if (!completed) throw new Error('Translation stream interrupted')
          output.finish()
          if (!received) throw new Error('Empty translation')
          controller.close()
        } catch (error) { controller.error(error) } finally { reader.releaseLock() }
      },
      cancel() { return reader.cancel() }
    })
    return new Response(stream, { headers })
  } catch { return new Response('Translation unavailable. Please try again.', { status: 502 }) }
}
