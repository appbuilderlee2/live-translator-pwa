import { traditional } from '../shared/traditional.mjs'

export function splitText(text, limit = 2000) {
  const chunks = []
  let remaining = text.trim()
  while (remaining.length > limit) {
    const head = remaining.slice(0, limit)
    const boundaries = [...head.matchAll(/[.!?。！？](?:\s|$)/g)]
    let end = boundaries.length ? boundaries.at(-1).index + 1 : head.lastIndexOf(' ')
    if (end < limit / 3) end = limit
    chunks.push(remaining.slice(0, end).trim()); remaining = remaining.slice(end).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}
export function numericValues(text) {
  const scale = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, 萬: 1e4, 万: 1e4, 億: 1e8, 亿: 1e8, 千: 1e3, 百: 1e2 }
  return [...text.normalize('NFKC').replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1').matchAll(/(\d+(?:\.\d+)?)(?:\s*(thousand|million|billion|trillion|萬|万|億|亿|千|百))?/gi)].map(match => Number((Number(match[1]) * (scale[match[2]?.toLowerCase()] || 1)).toPrecision(12)))
}
export function numericMismatch(en, zh) {
  const remaining = numericValues(zh)
  return numericValues(en).some(value => { const index = remaining.indexOf(value); if (index < 0) return true; remaining.splice(index, 1); return false })
}
export function recoverSegment(segment) {
  return { ...segment, zh: traditional(segment.zh || ''), status: segment.status === 'translating' ? 'pending' : segment.status }
}
export function retryableSegments(current, history) {
  return [...current, ...history.flatMap(session => session.segments)].filter(s => s.status === 'pending' || s.status === 'error')
}
export function previousContext(id, current, history) {
  const list = current.some(s => s.id === id) ? current : history.find(session => session.segments.some(s => s.id === id))?.segments || []
  const index = list.findIndex(s => s.id === id)
  return list.slice(Math.max(0, index - 2), Math.max(0, index)).map(({ en, zh }) => ({ en, zh }))
}
export function patchSegment(list, id, patch) { return list.map(s => s.id === id ? { ...s, ...patch } : s) }
