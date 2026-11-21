export async function translateHandler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
  let text
  try {
    const body = await req.json()
    text = body?.text
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error()
    text = text.trim()
  } catch { return new Response('Provide text between 1 and 2000 characters.', { status: 400 }) }
  const env = typeof process !== 'undefined' ? process.env : {}
  try {
    if (!env.OPENAI_API_KEY) {
      const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${encodeURIComponent(text)}`, { signal: req.signal })
      if (!response.ok) throw new Error('Translation provider unavailable')
      const data = await response.json()
      const result = data[0].map(part => part[0] || '').join('')
      if (!result) throw new Error('Empty translation')
      return new Response(result, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
    }
    const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: req.signal, headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-4o-mini', stream: true, messages: [{ role: 'system', content: 'translate to natural Traditional Chinese (Taiwan), output only the translation' }, { role: 'user', content: text }] }) })
    if (!response.ok || !response.body) throw new Error('Translation provider unavailable')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buffer = ''
    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { value, done } = await reader.read()
            buffer += decoder.decode(value, { stream: !done })
            const lines = buffer.split('\n'); buffer = lines.pop() || ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const payload = line.slice(6).trim()
              if (payload === '[DONE]') continue
              const event = JSON.parse(payload)
              if (event.error) throw new Error('Provider stream failed')
              const delta = event.choices?.[0]?.delta?.content
              if (delta) controller.enqueue(encoder.encode(delta))
            }
            if (done) break
          }
          controller.close()
        } catch (error) { controller.error(error) } finally { reader.releaseLock() }
      },
      cancel() { return reader.cancel() }
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  } catch { return new Response('Translation unavailable. Please try again.', { status: 502 }) }
}
