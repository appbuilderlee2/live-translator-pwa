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

export function createLimiter(limit = 2) {
  let count = 0
  const queue = []
  return async operation => {
    await new Promise(resolve => { queue.push(resolve); if (count < limit) { count++; queue.shift()() } })
    try { return await operation() } finally { if (queue.length) queue.shift()(); else count-- }
  }
}
