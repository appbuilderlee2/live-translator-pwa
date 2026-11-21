/** @template {{id: string, en: string, timestamp: number, status: string}} T
 * @param {{find: (id: string) => T | undefined, execute: (segment: T) => Promise<unknown>, online?: () => boolean, storage?: Pick<Storage, 'getItem' | 'setItem'>, changed?: (state: {pending: number, retryAt: number, reason: string}) => void}} options
 */
export function createTranslationQueue({ find, execute, online = () => navigator.onLine, storage, changed = () => {} }) {
  const entries = new Map()
  const key = 'lt-provider-retry-at'
  let timer; let active; let disposed = false; let nextAt = 0; let failures = 0; let reason = ''
  const stored = () => { try { return Math.min(Date.now() + 86400000, Number(storage?.getItem(key)) || 0) } catch { return 0 } }
  const persist = () => { try { storage?.setItem(key, String(nextAt)) } catch {} }
  const notify = () => changed({ pending: entries.size, retryAt: nextAt, reason })
  const schedule = () => {
    clearTimeout(timer)
    nextAt = Math.max(nextAt, stored())
    notify()
    const readyAt = Math.min(...[...entries.values()].map(entry => entry.retryAt))
    if (!disposed && !active && entries.size && online()) timer = setTimeout(pump, Math.max(0, nextAt - Date.now(), readyAt - Date.now()))
  }
  async function pump() {
    if (disposed || active || !online()) return
    if (Math.max(nextAt, stored()) > Date.now()) { schedule(); return }
    const candidates = [...entries.keys()].filter(id => entries.get(id).retryAt <= Date.now()).map(find).filter(segment => segment && segment.status !== 'done').sort((a, b) => a.timestamp - b.timestamp)
    for (const id of entries.keys()) if (!find(id) || find(id).status === 'done') entries.delete(id)
    const segment = candidates[0]
    if (!segment) { schedule(); return }
    active = segment.id
    try {
      await execute(segment)
      if (find(segment.id)?.en === segment.en) entries.delete(segment.id)
      failures = 0; reason = ''
      nextAt = Date.now() + 5500
    } catch (error) {
      reason = typeof error.code === 'string' ? error.code : 'upstream_unavailable'
      const delay = Math.max(Math.min(60000, 5000 * 2 ** Math.min(failures++, 4)), error.retryAfter || 0)
      nextAt = Date.now() + delay
      if (['translation_invalid', 'upstream_invalid_response'].includes(reason) && entries.has(segment.id)) {
        const entry = entries.get(segment.id)
        entry.retryAt = Date.now() + Math.max(error.retryAfter || 0, Math.min(60000, 5000 * 2 ** Math.min(entry.attempts++, 4)))
        nextAt = Date.now() + 5500
      }
      if (error.retryable === false && !error.retryAfter) entries.delete(segment.id)
    } finally { active = undefined; persist(); schedule() }
  }
  return {
    enqueue(id) { if (disposed) return; const segment = find(id); if (segment && segment.status !== 'done' && !entries.has(id)) entries.set(id, { retryAt: 0, attempts: 0 }); schedule() },
    wake: schedule,
    dispose() { disposed = true; clearTimeout(timer); entries.clear() }
  }
}
