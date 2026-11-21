import { meetingPrompt, normalizeBusiness, protectNames, protectCurrency, currencySource, literalCurrency } from './business.mjs'
import { traditional, translationBuffer } from './traditional.mjs'
import { withTimeout } from './retry.mjs'
import { createProviderGateway, providerResponse } from './provider.mjs'
import { negationMismatch, normalizeNegations } from './negation.mjs'
import { medicalPrompt, normalizeMedical, protectMedical, medicalTranslation, medicalWarnings } from './medical.mjs'
import { seatingMismatch } from './coverage.mjs'

const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
export function createTranslateHandler(options = {}) {
const gateway = createProviderGateway(options)
return async function translateHandler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
  let text; let context; let spoken; let preview
  try {
    const body = await req.json()
    text = body?.text
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error()
    text = text.trim()
    if (body.spoken !== undefined && typeof body.spoken !== 'boolean' || body.preview !== undefined && typeof body.preview !== 'boolean') throw new Error()
    spoken = body.spoken === true; preview = body.preview === true
    if (body.context !== undefined && (!Array.isArray(body.context) || body.context.length > 2 || body.context.some(s => !s || typeof s.en !== 'string' || typeof s.zh !== 'string' || s.en.length > 2000 || s.zh.length > 8000))) throw new Error()
    context = body.context || []
  } catch { return new Response('Provide text between 1 and 2000 characters and at most two context segments.', { status: 400 }) }
  if (preview) return Response.json({ error: 'previews_disabled' }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
  const literal = literalCurrency(text)
  if (literal) return new Response(literal, { headers })
  const env = typeof process !== 'undefined' ? process.env : {}
  const source = currencySource(text, spoken)
  const currency = protectCurrency(normalizeNegations(normalizeBusiness(source, context)))
  const attempt = operation => withTimeout(operation, { signal: req.signal, timeout: 6000 })
  let endpoint = ''; const started = Date.now()
  const upstream = (url, options) => { endpoint = url; return gateway.fetch(url, options) }
  try {
    gateway.check()
    if (!env.OPENAI_API_KEY) {
      const medical = protectMedical(currency.text, context)
      const protectedText = protectNames(medical.text)
      const result = await attempt(async signal => {
        const target = new URL(gateway.endpoint([env.GOOGLE_TRANSLATE_URL || 'https://translate.googleapis.com/translate_a/single', env.GOOGLE_TRANSLATE_FALLBACK_URL || 'https://translate.google.com/translate_a/single']))
        for (const [key, value] of Object.entries({ client: 'gtx', sl: 'en', tl: 'zh-TW', dt: 't', q: protectedText.text })) target.searchParams.set(key, value)
        const response = await upstream(target.toString(), { signal, preview })
        const data = await response.json()
        const result = data[0].map(part => part[0] || '').join('')
        if (!result.trim()) throw new Error('Empty translation')
        const translated = medicalTranslation(text, traditional(currency.restore(medical.restore(protectedText.restore(result))), text), context)
        if (negationMismatch(text, translated)) throw new Error('Translation lost a negation')
        if (medicalWarnings(text, translated, context).length) throw new Error('Translation changed medical meaning')
        if (seatingMismatch(text, translated)) throw new Error('Translation omitted source meaning')
        return translated
      })
      return new Response(result, { headers })
    }
    const messages = [{ role: 'system', content: `${meetingPrompt} ${medicalPrompt} Preserve __CURRENCY_UNIT__ verbatim; it is a neutral currency unit, not USD. Keep the scope of every not, don't, never, and no. In particular, not 30.2 million must exclude that amount (不是 3020 萬); an unrelated 不變 does not preserve that exclusion. Never turn an exclusion into a positive amount or a less-than comparison.` }]
    if (context.length) messages.push({ role: 'user', content: `Previous committed segments (context only):\n${JSON.stringify(context)}` }, { role: 'assistant', content: 'I will use these only for terminology consistency.' })
    messages.push({ role: 'user', content: normalizeMedical(currency.text, context) })
    const response = await attempt(signal => upstream('https://api.openai.com/v1/chat/completions', { method: 'POST', signal, headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-4o-mini', stream: true, messages }) }))
    if (!response.body) throw new Error('Missing stream')
    const reader = response.body.getReader(); const decoder = new TextDecoder(); const encoder = new TextEncoder()
    let buffer = ''; let received = false; let completed = false; let translated = ''; let raw = ''
    const stream = new ReadableStream({
      async start(controller) {
        const output = translationBuffer(chunk => { if (chunk) { const restored = medicalTranslation(text, currency.restore(chunk, false), context); translated += restored; received = true; controller.enqueue(encoder.encode(restored)) } }, text)
        const line = value => {
          if (!value.startsWith('data: ')) return
          const payload = value.slice(6).trim()
          if (payload === '[DONE]') { completed = true; return }
          const event = JSON.parse(payload)
          if (event.error) throw new Error('Provider stream failed')
          const delta = event.choices?.[0]?.delta?.content
          if (delta) { raw += delta; output.push(delta) }
        }
        try {
          while (true) {
            const { value, done } = await withTimeout(() => reader.read(), { signal: req.signal, timeout: preview ? 1200 : 4000 })
            buffer += decoder.decode(value, { stream: !done })
            const lines = buffer.split('\n'); buffer = lines.pop() || ''
            for (const value of lines) line(value)
            if (done) break
          }
          if (buffer) line(buffer)
          if (!completed) throw new Error('Translation stream interrupted')
          output.finish()
          if (!received) throw new Error('Empty translation')
          currency.restore(raw)
          if (negationMismatch(text, translated)) throw new Error('Translation lost a negation')
          if (medicalWarnings(text, translated, context).length) throw new Error('Translation changed medical meaning')
          if (seatingMismatch(text, translated)) throw new Error('Translation omitted source meaning')
          controller.close()
        } catch (error) { if (typeof error.code !== 'string') gateway.invalid(error, endpoint, started); void reader.cancel(error).catch(() => {}); controller.error(error) } finally { reader.releaseLock() }
      },
      cancel() { return reader.cancel() }
    })
    return new Response(stream, { headers })
  } catch (error) { return providerResponse(typeof error.code !== 'string' && endpoint ? gateway.invalid(error, endpoint, started) : error) }
}
}

export const translateHandler = createTranslateHandler()
