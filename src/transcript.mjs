import { traditional } from '../shared/traditional.mjs'
import { readableChinese } from '../shared/phrasing.mjs'
import { numericValues } from './numbers.mjs'
export { numericValues } from './numbers.mjs'

export const unfinishedSpeech = text => /\b(?:am|is|are|was|were|be|been|being|the|a|an|my|your|our|their|to|of|at|in|on|with|for|and|or|but|not|over)[.!?]*$/i.test(text.trim())

export function translationReady(segment) {
  return !segment.provisional && !segment.forced && segment.settled !== false
}

const sourceKey = text => text.trim().replace(/\s+/g, ' ').replace(/(?<!\.)\.$/, '')

export function reviseRecognizedSegment(segment, en, metadata) {
  const translation = segment.translation || (segment.status === 'done' && translationReady(segment) && segment.zh ? { source: segment.en, text: segment.zh } : undefined)
  const revised = { ...segment, en, ...metadata, translation }
  if (!translationReady(revised)) return { ...revised, zh: '', status: 'pending' }
  if (translation && sourceKey(translation.source) === sourceKey(en)) return { ...revised, zh: translation.text, status: 'done' }
  return segment.en !== en ? { ...revised, zh: '', status: 'pending' } : revised
}

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
export function numericMismatch(en, zh) {
  const remaining = numericValues(zh)
  return numericValues(en).some(value => { const index = remaining.indexOf(value); if (index < 0) return true; remaining.splice(index, 1); return false })
}
export function recoverSegment(segment) {
  const recovered = { ...segment }
  if (!segment.provisional && !segment.forced && segment.settled === false && !unfinishedSpeech(segment.en)) recovered.settled = true
  return { ...recovered, zh: translationReady(recovered) ? readableChinese(segment.en, traditional(segment.zh || '', segment.en)) : '', status: !translationReady(recovered) || segment.status === 'translating' ? 'pending' : segment.status }
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
