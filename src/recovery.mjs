export function createTranslationRecovery({ find, retry, online = () => navigator.onLine, delay = 1000 }) {
  const entries = new Map()
  const clear = id => { clearTimeout(entries.get(id)?.timer); entries.delete(id) }
  return {
    begin(id) { clearTimeout(entries.get(id)?.timer); if (entries.has(id)) entries.get(id).timer = undefined },
    failed(id) {
      const entry = entries.get(id) || { attempts: 0 }
      if (entry.timer !== undefined) return
      entry.timer = setTimeout(() => {
        entry.timer = undefined
        const segment = find(id)
        if (!segment || segment.status === 'done') clear(id)
        else if (online() && ['error', 'pending'].includes(segment.status)) retry(segment)
      }, Math.min(delay * 2 ** Math.min(entry.attempts++, 5), 30000))
      entries.set(id, entry)
    },
    succeeded: clear,
    dispose() { for (const id of entries.keys()) clear(id) }
  }
}
