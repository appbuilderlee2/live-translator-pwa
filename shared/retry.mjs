export async function retry(operation, { signal, attempts = 3, delay = 180 } = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    try { return await operation() } catch (error) {
      if (signal?.aborted || error.retryable === false || attempt + 1 >= attempts) throw error
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, delay * (attempt + 1))
        signal?.addEventListener('abort', abort, { once: true })
      })
    }
  }
}

export async function withTimeout(operation, { signal, timeout = 3000 } = {}) {
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  combined.throwIfAborted()
  let abort
  const cancelled = new Promise((_, reject) => { abort = () => reject(combined.reason); combined.addEventListener('abort', abort, { once: true }) })
  const timer = setTimeout(() => controller.abort(new DOMException('Translation timed out', 'TimeoutError')), timeout)
  try { return await Promise.race([operation(combined), cancelled]) }
  finally { clearTimeout(timer); combined.removeEventListener('abort', abort) }
}

export function createLimiter(limit = 2) {
  let count = 0
  const queue = []
  const drain = () => {
    while (count < limit && queue.length) { count++; queue.shift().start() }
  }
  return async (operation, { signal, priority = 0 } = {}) => {
    signal?.throwIfAborted()
    await new Promise((resolve, reject) => {
      const abort = () => { const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1); reject(signal.reason) }
      const entry = { priority, start() { signal?.removeEventListener('abort', abort); resolve() } }
      signal?.addEventListener('abort', abort, { once: true })
      queue.push(entry); queue.sort((a, b) => b.priority - a.priority); drain()
    })
    try { signal?.throwIfAborted(); return await operation() } finally { count--; drain() }
  }
}

export function createRateLimiter(interval = 150) {
  const gate = createLimiter(1)
  let previous = -Infinity
  return async (operation, options = {}) => {
    await gate(async () => {
      const delay = Math.min(interval, Math.max(0, interval - (Date.now() - previous)))
      if (delay) await new Promise((resolve, reject) => {
        const signal = options.signal
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, delay)
        signal?.addEventListener('abort', abort, { once: true })
      })
      options.signal?.throwIfAborted()
      previous = Date.now()
    }, options)
    options.signal?.throwIfAborted()
    return operation()
  }
}
