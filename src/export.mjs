import { translationReady } from './transcript.mjs'

/** @template {{ status: string }} T
 * @param {() => T[]} read
 */
export async function waitForTranslations(read, { timeout = 2000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout
  while (read().some(segment => segment.status !== 'done') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(interval, deadline - Date.now())))
  }
  return read()
}

/** @template {{ timestamp: number, en: string, zh: string, status: string, confidence?: number, forced?: boolean, provisional?: boolean }} T
 * @param {T[]} segments
 * @param {(segment: T, context: T[]) => string[]} [warnings]
 */
export function formatTranscript(segments, warnings = () => []) {
  return segments.map((segment, index) => {
    const lines = [new Date(segment.timestamp).toLocaleString(), segment.en]
    if (segment.status !== 'done' || !translationReady(segment)) lines.push('[翻譯尚未完成 / Translation still pending; English preserved]')
    if (segment.zh && translationReady(segment)) lines.push(segment.zh)
    if (!segment.provisional && !segment.forced && segment.confidence !== undefined) lines.push(`辨識信心 / Confidence: ${Math.round(segment.confidence * 100)}%`)
    if (segment.forced) lines.push('暫存語音，尚未收到最終辨識 / Saved speech; final recognition unavailable')
    else if (segment.provisional) lines.push('暫定字幕 / Provisional speech')
    for (const warning of warnings(segment, segments.slice(Math.max(0, index - 2), index))) lines.push(`⚠ 請核對 Check: ${warning}`)
    return lines.join('\n')
  }).join('\n\n')
}
