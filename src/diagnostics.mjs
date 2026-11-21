const flag = 'lt-dispatch-diagnostics'
const key = 'lt-dispatch-log'

const browserStorage = () => typeof window === 'undefined' ? undefined : window.localStorage

export function diagnosticsEnabled(storage) {
  try { return (storage || browserStorage())?.getItem(flag) === '1' } catch { return false }
}

export function speechEvidence(session, start, end) {
  if (!diagnosticsEnabled()) return {}
  return { recognitionEvidence: { session: session.id, range: [start, end], terminal: !!session.terminal, finalRanges: session.finals.map(range => ({ ...range })) } }
}

export function exportDispatchDiagnostics(storage) {
  try {
    storage ||= browserStorage()
    const records = JSON.parse(storage?.getItem(key) || '[]')
    return JSON.stringify({ version: 1, records: Array.isArray(records) ? records : [] }, null, 2)
  } catch { return JSON.stringify({ version: 1, records: [] }, null, 2) }
}

export function recordTranslationDispatch(segment, context = [], storage) {
  if (!diagnosticsEnabled(storage)) return
  try {
    storage ||= browserStorage()
    const { records } = JSON.parse(exportDispatchDiagnostics(storage))
    records.push({ timestamp: new Date().toISOString(), captionId: segment.id, text: segment.en, provisional: !!segment.provisional, forced: !!segment.forced, settled: segment.settled ?? null, unconfirmed: !!segment.unconfirmed, evidence: segment.recognitionEvidence ?? null, reason: segment.spoken ? segment.unconfirmed ? 'session-end-unconfirmed' : 'native-final-ready' : 'typed', retry: segment.status === 'error', context })
    storage.setItem(key, JSON.stringify(records.slice(-500)))
  } catch {}
}
