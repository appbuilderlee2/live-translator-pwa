import { numericValues, splitText } from './transcript.mjs'

const words = text => [...text.matchAll(/\S+/g)]
const normalized = text => words(text).map(w => w[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
const slice = (text, tokens, start, end) => end > start ? text.slice(tokens[start].index, tokens[end - 1].index + tokens[end - 1][0].length) : ''
function sentences(text) {
  return text.split(/(?<=[.!?])\s+/).flatMap(s => splitText(s)).flatMap(s => {
    const tokens = words(s)
    if (tokens.length <= 40) return [s]
    return Array.from({ length: Math.ceil(tokens.length / 30) }, (_, i) => slice(s, tokens, i * 30, Math.min((i + 1) * 30, tokens.length)))
  }).filter(Boolean)
}
function session() { return { text: '', parts: [], finals: [], committedCharacters: 0, timer: undefined, awaitingFinal: false, flushed: false, observations: [], risks: [], afterRestart: false } }
function risk(s, start, end, reason) {
  if (!s.risks.some(r => r.start === start && r.end === end && r.reason === reason)) s.risks.push({ start, end, reason })
}
function missing(values, expected) {
  const remaining = [...expected]
  return values.some(value => { const index = remaining.indexOf(value); if (index < 0) return true; remaining.splice(index, 1); return false })
}

export function createSpeechController(rec, { commit, revise = (_id, _text, _meta) => {}, preview, state, message }) {
  rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'; rec.maxAlternatives = 3
  let wanted = false; let running = false; let current = session(); let closing; let pause
  let retryTimer; let failures = 0; let failed = false
  const timers = new Set()
  const later = fn => {
    const timer = setTimeout(() => { timers.delete(timer); fn() }, 250)
    timers.add(timer)
    return timer
  }
  const metadata = (s, start, end, saved = false) => {
    const final = s.finals.find(range => end <= range.end)
    return { confidence: final?.confidence, provisional: !final, forced: !final && saved, numericWarnings: [...new Set(s.risks.filter(r => r.start < end && r.end > start).map(r => r.reason))] }
  }
  const publishedWords = s => s.parts.reduce((sum, p) => sum + p.count, 0)
  function publish(s, start, end, saved = false) {
    const tokens = words(s.text)
    for (const text of sentences(slice(s.text, tokens, start, end))) {
      const count = words(text).length
      const meta = metadata(s, start, start + count, saved)
      start += count
      s.parts.push({ id: commit(text, meta), text, count, ...meta })
    }
    s.committedCharacters = end ? tokens[end - 1].index + tokens[end - 1][0].length : 0
  }
  function reconcile(s, text, finals) {
    const committed = normalized(s.parts.map(p => p.text).join(' ')); const next = normalized(text)
    let matching = 0
    while (matching < Math.min(committed.length, next.length) && committed[matching] === next[matching]) matching++
    s.text = text; s.finals = finals; s.awaitingFinal = (finals.at(-1)?.end || 0) < words(text).length
    const tokens = words(text)
    let offset = 0
    for (const [index, part] of s.parts.entries()) {
      let end = Math.min(offset + part.count, tokens.length)
      const final = finals.find(range => offset < range.end)
      if (part.provisional && index === s.parts.length - 1 && final) {
        const completed = slice(text, tokens, offset, final.end)
        if (words(completed).length <= 40 && sentences(completed).length === 1) end = final.end
      }
      const replacement = slice(text, tokens, offset, end)
      const meta = metadata(s, offset, end, part.forced)
      const accepted = meta.provisional ? part.text : replacement
      if ((!meta.provisional && (matching < end || part.text !== accepted)) || part.provisional !== meta.provisional || part.confidence !== meta.confidence || part.numericWarnings?.join() !== meta.numericWarnings.join()) revise(part.id, accepted, meta)
      Object.assign(part, { text: accepted, count: words(accepted).length, ...meta })
      offset += part.count
    }
    s.parts = s.parts.filter(p => p.count)
    const finalEnd = finals.at(-1)?.end || 0
    if (finalEnd > offset) publish(s, offset, finalEnd)
    const published = Math.min(publishedWords(s), tokens.length)
    s.committedCharacters = published ? tokens[published - 1].index + tokens[published - 1][0].length : 0
  }
  function stable(s, paused = false, previous = s.text) {
    const tokens = words(s.text); const start = publishedWords(s)
    const old = normalized(previous); const next = normalized(s.text)
    const committed = normalized(s.parts.map(p => p.text).join(' '))
    if (committed.some((word, i) => word !== next[i])) return
    let common = 0
    while (common < Math.min(old.length, next.length) && old[common] === next[common]) common++
    let end = start
    for (let i = start; i < common; i++) if (/[.!?,;:]$/.test(tokens[i][0])) end = i + 1
    if (paused) end = common
    else if (end === start && common - start >= 25) end = common - 1
    if (end > start) publish(s, start, end)
  }
  function flush(s) {
    s.flushed = true
    clearTimeout(s.timer); timers.delete(s.timer)
    const start = publishedWords(s); const end = words(s.text).length
    if (end > start) publish(s, start, end, true)
    for (const part of s.parts) if (part.provisional && !part.forced) {
      part.forced = true; revise(part.id, part.text, { confidence: undefined, provisional: true, forced: true })
    }
  }
  function previewCurrent() { preview(current.text.slice(current.committedCharacters).trim()) }
  rec.onstart = rec.onaudiostart = () => { failed = false; clearTimeout(retryTimer); retryTimer = undefined; if (wanted) { state('listening'); if (!failures) message('') } }
  rec.onresult = event => {
    message('')
    const rows = Array.from(event.results, result => ({ text: result[0].transcript.trim(), final: result.isFinal, confidence: result[0].confidence, alternatives: Array.from(result, a => a.transcript) })).filter(r => r.text)
    const text = rows.map(r => r.text).join(' ')
    let count = 0
    const finals = []
    for (const row of rows) { count += words(row.text).length; if (row.final) finals.push({ end: count, confidence: Number.isFinite(row.confidence) ? row.confidence : undefined }); else break }
    const candidate = normalized(text); const old = normalized(closing?.text || '')
    const overlap = candidate.slice(0, 10).filter(word => old.slice(0, 10).includes(word)).length
    const matchesClosing = closing?.awaitingFinal && finals.length && ((!closing.flushed && !current.text) || overlap >= Math.min(candidate.length, old.length, 10) * .6)
    const target = matchesClosing ? closing : current
    const previous = target.text
    let offset = 0
    for (const row of rows) {
      const end = offset + words(row.text).length
      const values = numericValues(row.text)
      if (row.alternatives.some(alt => numericValues(alt).join() !== values.join())) risk(target, offset, end, 'alternatives')
      offset = end
    }
    const finalEnd = finals.at(-1)?.end || 0
    const tokens = words(text)
    if (finalEnd === tokens.length) {
      for (const observation of target.observations) if (missing(observation.values, numericValues(slice(text, tokens, Math.min(observation.start, finalEnd), finalEnd)))) risk(target, observation.start, finalEnd, 'interim')
      target.observations = []
    } else {
      const values = numericValues(slice(text, tokens, finalEnd, tokens.length))
      if (values.length && !target.observations.some(o => o.start === finalEnd && o.values.join() === values.join())) target.observations.push({ start: finalEnd, values })
    }
    if (target.afterRestart && numericValues(rows[0]?.text || '').length) risk(target, 0, words(rows[0].text).length, 'boundary')
    reconcile(target, text, finals)
    if (target === closing) { clearTimeout(target.timer); timers.delete(target.timer); target.timer = later(() => flush(target)); return }
    failed = false; failures = 0; clearTimeout(retryTimer); retryTimer = undefined
    if (text !== previous) { clearTimeout(pause); pause = setTimeout(() => { stable(current, true); previewCurrent() }, 1200) }
    if (words(text).length - publishedWords(current) > 25) stable(current, false, previous)
    previewCurrent()
  }
  rec.onerror = event => {
    if (['not-allowed', 'service-not-allowed'].includes(event.error)) {
      wanted = false; state('idle'); message(`無法使用麥克風（${event.error}）。請依下方「麥克風設定說明」允許權限，或改用英文輸入。Microphone ${event.error}. Follow Microphone help below to allow access, or type English.`)
    } else if (['audio-capture', 'network'].includes(event.error)) {
      failed = true
      message(event.error === 'network' ? '麥克風語音服務網路錯誤（network），正在重試。請檢查網路或按「重試麥克風」。Microphone speech-service network error (network). Retrying; check your connection or Retry mic.' : '麥克風擷取失敗（audio-capture），正在重試。請檢查麥克風連線與權限，或按「重試麥克風」。Microphone capture error (audio-capture). Retrying; check microphone connection and permissions or Retry mic.')
      scheduleRetry()
    } else if (event.error === 'no-speech') message('未偵測到語音，請靠近麥克風再說一次。No speech detected. Try speaking closer to your microphone.')
    else if (event.error !== 'aborted') message(`語音辨識錯誤（${event.error}），仍可輸入英文翻譯。Speech recognition: ${event.error}. You can still type below.`)
  }
  rec.onend = () => {
    clearTimeout(pause); running = false
    const ended = current
    if (ended.awaitingFinal) {
      const start = ended.finals.at(-1)?.end || 0
      const end = words(ended.text).length
      if (numericValues(slice(ended.text, words(ended.text), start, end)).length) { risk(ended, start, end, 'boundary'); reconcile(ended, ended.text, ended.finals) }
    }
    if (closing && closing !== ended) flush(closing)
    closing = ended
    ended.timer = later(() => flush(ended))
    current = session(); current.afterRestart = ended.awaitingFinal; preview('')
    if (wanted && failed) scheduleRetry()
    else if (wanted) startRecognition()
    else state('idle')
  }
  function startRecognition() {
    try { state('requesting'); running = true; rec.start() } catch { running = false; failed = true; message('無法啟動麥克風，正在重試。請檢查權限或按「重試麥克風」。Could not start microphone. Retrying; check permissions or Retry mic.'); scheduleRetry() }
  }
  function scheduleRetry() {
    if (!wanted || retryTimer !== undefined) return
    state('retrying')
    retryTimer = setTimeout(() => { retryTimer = undefined; if (wanted) startRecognition() }, Math.min(500 * 2 ** failures++, 5000))
  }
  return {
    start() { wanted = true; failed = false; failures = 0; clearTimeout(retryTimer); retryTimer = undefined; message(''); startRecognition() },
    stop() {
      wanted = false; clearTimeout(pause); clearTimeout(retryTimer); retryTimer = undefined; state('idle')
      const stopped = current
      stopped.timer = later(() => flush(stopped))
      if (running) { try { rec.stop() } catch { running = false; flush(stopped) } }
    },
    async finish() { clearTimeout(pause); if (closing) flush(closing); flush(current); previewCurrent() },
    dispose() { wanted = false; clearTimeout(pause); clearTimeout(retryTimer); for (const timer of timers) clearTimeout(timer); rec.onend = null; rec.onresult = null; rec.onstart = null; rec.onaudiostart = null; rec.onerror = null }
  }
}
