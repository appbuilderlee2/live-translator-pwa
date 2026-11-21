import { retryAfter, withTimeout } from './retry.mjs'

export function providerResponse(error) {
  const status = [429, 502, 503].includes(error.status) ? error.status : 502
  return Response.json({ error: error.code || 'translation_invalid', message: 'Translation delayed; English preserved.', retryAfterMs: error.retryAfter || 0 }, { status, headers: { 'Cache-Control': 'no-store', ...(error.retryAfter ? { 'Retry-After': String(Math.ceil(error.retryAfter / 1000)) } : {}) } })
}

export function createProviderGateway({ interval = 5500, baseDelay = 5000, log = value => console.warn(JSON.stringify(value)) } = {}) {
  let nextAt = 0; let cooldown = 0; let failures = 0; let alternate = 0
  const delayed = () => Object.assign(new Error('Provider cooldown'), { status: 429, code: 'provider_cooldown', retryAfter: Math.max(1, Math.max(cooldown, nextAt) - Date.now()) })
  const fail = (error, url, started, snippet = '', secret = '') => {
    if (secret) snippet = snippet.split(secret).join('[redacted]')
    snippet = snippet.replace(/Bearer\s+[^\s"<>]+|sk-[\w-]+|https?:\/\/[^\s"<>]+/gi, '[redacted]').replace(/(?:api[_-]?key|access[_-]?token|authorization|password)["'\s:=]+[^\s,"'<>]+/gi, '[redacted]').replace(/[\r\n\t]+/g, ' ').slice(0, 160)
    const endpoint = new URL(url)
    log({ event: 'translation_upstream_failure', provider: endpoint.hostname === 'api.openai.com' ? 'openai' : 'google', endpoint: endpoint.origin + endpoint.pathname, status: error.upstreamStatus ?? error.status ?? 0, latencyMs: Date.now() - started, reason: error.code, snippet })
    if (error.status === 429 || error.status >= 500 || !error.status) {
      cooldown = Date.now() + Math.max(Math.min(60000, baseDelay * 2 ** Math.min(failures++, 4)), error.retryAfter || 0)
      alternate++
      error.retryAfter = Math.max(1, Math.max(cooldown, nextAt) - Date.now())
    }
    return error
  }
  return {
    invalid(error, url, started) { return fail(Object.assign(new Error(error.message), { status: 502, upstreamStatus: 200, code: 'upstream_invalid_response' }), url, started) },
    endpoint(urls) { return urls[alternate % urls.length] },
    check() { if (Date.now() < Math.max(cooldown, nextAt)) throw delayed() },
    async fetch(url, options) {
      this.check()
      nextAt = Date.now() + interval
      const started = Date.now()
      let response
      try { response = await withTimeout(signal => fetch(url, { ...options, signal }), { signal: options.signal, timeout: 5000 }) }
      catch (cause) {
        const error = Object.assign(new Error('Upstream connection failed'), { upstreamStatus: 0, status: 503, code: cause.name === 'TimeoutError' ? 'upstream_timeout' : 'upstream_unavailable' })
        throw fail(error, url, started)
      }
      if (!response.ok) {
        let snippet = ''
        const reader = response.body?.getReader()
        if (reader) {
          try { const { value } = await withTimeout(() => reader.read(), { timeout: 500 }); snippet = new TextDecoder().decode(value?.slice(0, 512)) } catch {} finally { void reader.cancel().catch(() => {}) }
        }
        const error = Object.assign(new Error('Upstream rejected translation'), { upstreamStatus: response.status, status: response.status === 429 ? 429 : response.status >= 500 ? response.status === 502 ? 502 : 503 : 502, code: response.status === 429 ? 'upstream_rate_limited' : 'upstream_error', retryAfter: retryAfter(response.headers.get('Retry-After'), Date.now(), 86400000) })
        const authorization = options.headers?.Authorization || ''
        const secret = authorization.replace(/^Bearer\s+/i, '')
        const result = fail(error, url, started, snippet, secret)
        return Promise.reject(result)
      }
      failures = 0; cooldown = 0
      return response
    }
  }
}
