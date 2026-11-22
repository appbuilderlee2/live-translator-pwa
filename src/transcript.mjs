import { traditional } from '../shared/traditional.mjs'
import { readableChinese } from '../shared/phrasing.mjs'
import { numericValues } from './numbers.mjs'
export { numericValues } from './numbers.mjs'

export const unfinishedSpeech = text => /\b(?:am|is|are|was|were|be|been|being|the|a|an|my|your|our|their|to|of|at|in|on|with|for|and|or|but|not|over)[.!?]*$/i.test(text.trim())

export function translationReady(segment) {
  return !segment.provisional && !segment.forced && segment.settled !== false
}

function captionBoundary(segment) {
  if (segment.recognitionBoundary) return segment.recognitionBoundary
  const evidence = segment.recognitionEvidence
  if (!Array.isArray(evidence?.range) || !Array.isArray(evidence.finalRanges)) return
  let start = 0
  for (const final of evidence.finalRanges) {
    if (final?.end >= evidence.range[1]) return final.saved ? undefined : { session: evidence.session, range: evidence.range, finalRange: [start, final.end] }
    start = final?.end
  }
}

/** @template {{ en: string, zh: string, status: string }} T
 * @param {T[]} segments
 * @returns {T[]}
 */
export function displayTranscript(segments) {
  let displayed = segments
  for (let index = 0; index < segments.length - 1; index++) {
    const previous = segments[index]; const next = segments[index + 1]
    if (previous.status !== 'done' || next.status !== 'done' || !translationReady(previous) || !translationReady(next)) continue
    const left = captionBoundary(previous); const right = captionBoundary(next)
    if (!left?.session || left.session !== right?.session || !Array.isArray(left.range) || !Array.isArray(right.range)) continue
    if (!(left.range[0] >= 0 && left.range[0] < left.range[1] && left.range[1] === right.range[0] && right.range[0] < right.range[1])) continue
    if (!Array.isArray(left.finalRange) || !Array.isArray(right.finalRange)) continue
    if (!(left.finalRange[0] >= 0 && left.finalRange[0] <= left.range[0] && left.finalRange[1] >= right.range[1] && left.finalRange[0] === right.finalRange[0] && left.finalRange[1] === right.finalRange[1])) continue
    if (!/\b(?:make|makes|made|making)\s+(?:the|this|that|these|those|our|your|their|its|my|an?)\s+[a-z][a-z'-]*$/i.test(previous.en.trim())) continue
    if (!/^(?:easier|harder|simpler|safer|more\s+(?:difficult|reliable|efficient|effective))\s+to\s+[a-z]/i.test(next.en.trim())) continue
    if (!/(?:使|讓)[\p{Script=Han}\d]{1,16}。$/u.test(previous.zh) || !/^(?:更|比較)/u.test(next.zh)) continue
    if (displayed === segments) displayed = segments.slice()
    displayed[index] = { ...previous, zh: previous.zh.slice(0, -1) }
  }
  return displayed
}

const sourceKey = text => text.trim().replace(/\s+/g, ' ').replace(/(?<!\.)\.$/, '')
export const sameRecognizedSource = (left, right) => sourceKey(left) === sourceKey(right)

export function reviseRecognizedSegment(segment, en, metadata) {
  const translation = segment.translation || (segment.status === 'done' && translationReady(segment) && segment.zh ? { source: segment.en, text: segment.zh } : undefined)
  const revised = { ...segment, en, ...metadata, translation }
  if (!translationReady(revised)) return { ...revised, zh: '', status: 'pending' }
  if (translation && sourceKey(translation.source) === sourceKey(en)) return { ...revised, zh: translation.text, status: 'done' }
  return !sameRecognizedSource(segment.en, en) ? { ...revised, zh: '', status: 'pending' } : revised
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
