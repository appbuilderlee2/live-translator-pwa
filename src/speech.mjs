import { numericValues, splitText, unfinishedSpeech } from './transcript.mjs'

const words = text => [...text.matchAll(/\S+/g)]
const normalized = text => words(text).map(w => w[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
const filler = text => /^(?:a|an|the|um|uh|er|ah|and|or|but|to|of|in|on|at|for|with|is|are|was|were|be|been|can)$/i.test(normalized(text).join(' '))
const slice = (text, tokens, start, end) => end > start ? text.slice(tokens[start].index, tokens[end - 1].index + tokens[end - 1][0].length) : ''
function sentences(text) {
  return text.split(/(?<=[.!?])\s+/).flatMap(s => splitText(s)).flatMap(s => {
    const tokens = words(s)
    if (tokens.length <= 40) return [s]
    const chunks = []
    for (let start = 0; start < tokens.length;) {
      let end = Math.min(start + 30, tokens.length)
      if (end < tokens.length && /^please[,;:]?$/i.test(tokens[end - 1][0])) end--
      chunks.push(slice(s, tokens, start, end)); start = end
    }
    return chunks
  }).filter(Boolean)
}
function related(left, right) {
  const a = normalized(left); const b = normalized(right)
  let prefix = 0
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++
  if (prefix >= Math.min(a.length, b.length) || prefix >= 2 || prefix === 1 && a.length === 2 && b.length === 2 && a[0].length >= 4) return true
  const remaining = [...b]
  const shared = a.filter(word => { const index = remaining.indexOf(word); if (index < 0) return false; remaining.splice(index, 1); return true }).length
  return shared >= Math.min(a.length, b.length) * .6
}
function session() { return { text: '', rows: [], retained: [], parts: [], finals: [], committedCharacters: 0, timer: undefined, awaitingFinal: false, flushed: false, observations: [], risks: [], afterRestart: false } }
function trackRows(s, incoming) {
  const first = s.rows.find(row => !row.final)?.index
  const before = normalized(s.rows.filter(row => row.index >= first).map(row => row.text).join(' ')).join(' ')
  const after = normalized(incoming.filter(row => row.index >= first).map(row => row.text).join(' ')).join(' ')
  const prefix = before.split(' ').slice(0, 2).join(' ')
  const repartitioned = before && after && (before.startsWith(after) || after.startsWith(before) || prefix.includes(' ') && after.startsWith(`${prefix} `))
  s.rows = incoming.map(row => {
    const previous = s.rows.find(old => old.index === row.index)
    if (previous && !previous.final) {
      const observed = previous.observed || previous
      const fragment = !row.final && words(observed.text).length <= 3 && !/[.!?]$/.test(observed.text) && !numericValues(observed.text).length && !s.parts.some(part => part.text === observed.text)
      if (!fragment && !repartitioned && !related(observed.text, row.text)) {
        if (!row.final) return previous
        s.retained.push({ ...observed, final: true, saved: true, confidence: undefined })
      }
      if (!row.final) return { ...row, observed: words(row.text).length >= words(observed.text).length ? row : observed }
    }
    return row
  })
  return s.rows.flatMap(row => [...s.retained.filter(old => old.index === row.index), row])
}
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
  let retryTimer; let failures = 0; let failed = false; let immediateRetry = false
  const timers = new Set()
  const later = fn => {
    const timer = setTimeout(() => { timers.delete(timer); fn() }, 250)
    timers.add(timer)
    return timer
  }
  const metadata = (s, start, end, saved = false) => {
    const final = s.finals.find(range => end <= range.end)
    return { confidence: final?.confidence, numericAlternatives: final?.alternatives || [], provisional: !final || !!final.saved || !s.flushed && end === words(s.text).length && unfinishedSpeech(slice(s.text, words(s.text), start, end)), forced: !!final?.saved || !final && saved, numericWarnings: [...new Set(s.risks.filter(r => r.start < end && r.end > start).map(r => r.reason))] }
  }
  const publishedWords = s => s.parts.reduce((sum, p) => sum + p.count, 0)
  function settle(s) {
    for (const part of s.parts) {
      if (part.settled || part.provisional || part.forced || part.settleTimer) continue
      const text = part.text
      const timer = setTimeout(() => {
        timers.delete(timer); part.settleTimer = undefined
        if (!s.parts.includes(part) || part.text !== text || part.provisional || part.forced) return
        if (part === s.parts.at(-1) && s.awaitingFinal && !s.flushed) return
        part.settled = true
        const start = s.parts.slice(0, s.parts.indexOf(part)).reduce((sum, p) => sum + p.count, 0)
        revise(part.id, part.text, { ...metadata(s, start, start + part.count), settled: true })
      }, /[.!?]["')\]]?$/.test(text) && !/\b(?:Mr|Mrs|Ms|Dr|Prof|etc|U\.S|U\.K)\.$/i.test(text) ? 750 : 2000)
      part.settleTimer = timer; timers.add(timer)
    }
  }
  function publish(s, start, end, saved = false) {
    const tokens = words(s.text)
    while (start < end) {
      const boundary = Math.min(end, s.finals.find(range => range.end > start)?.end || end)
      for (const text of sentences(slice(s.text, tokens, start, boundary))) {
        const count = words(text).length
        const meta = metadata(s, start, start + count, saved)
        start += count
        s.parts.push({ id: commit(text, { ...meta, settled: false }), text, count, ...meta, settled: false })
      }
    }
    s.committedCharacters = end ? tokens[end - 1].index + tokens[end - 1][0].length : 0
  }
  function reconcile(s, text, finals) {
    const committed = normalized(s.parts.map(p => p.text).join(' ')); const next = normalized(text)
    let matching = 0
    while (matching < Math.min(committed.length, next.length) && committed[matching] === next[matching]) matching++
    s.text = text; s.finals = finals; s.awaitingFinal = (finals.at(-1)?.end || 0) < words(text).length || unfinishedSpeech(text)
    const tokens = words(text)
    let offset = 0
    for (const [index, part] of s.parts.entries()) {
      let end = Math.min(offset + part.count, tokens.length)
      const final = finals.find(range => offset < range.end)
      if (index === s.parts.length - 1 && final) {
        const completed = sentences(slice(text, tokens, offset, final.end))[0]
        if (completed && words(completed).length <= 40) end = offset + words(completed).length
      }
      if (end > offset && end < tokens.length && /^please[,;:]?$/i.test(tokens[end - 1][0])) end--
      const replacement = slice(text, tokens, offset, end)
      const meta = metadata(s, offset, end, part.forced)
      const extended = final?.saved && normalized(replacement).slice(0, part.count).join() === normalized(part.text).join()
      const accepted = meta.provisional && !extended ? part.text : replacement
      const settled = part.settled && part.text === accepted && !meta.provisional
      if (part.text !== accepted || part.provisional !== meta.provisional) { clearTimeout(part.settleTimer); timers.delete(part.settleTimer); part.settleTimer = undefined }
      if ((!meta.provisional && matching < end) || part.text !== accepted || part.provisional !== meta.provisional || part.forced !== meta.forced || part.confidence !== meta.confidence || part.settled !== settled || part.numericWarnings?.join() !== meta.numericWarnings.join() || JSON.stringify(part.numericAlternatives) !== JSON.stringify(meta.numericAlternatives)) revise(part.id, accepted, { ...meta, settled })
      Object.assign(part, { text: accepted, count: words(accepted).length, ...meta, settled })
      offset += part.count
    }
    s.parts = s.parts.filter(p => p.count)
    const finalEnd = finals.at(-1)?.end || 0
    if (finalEnd > offset) publish(s, offset, finalEnd)
    const published = Math.min(publishedWords(s), tokens.length)
    s.committedCharacters = published ? tokens[published - 1].index + tokens[published - 1][0].length : 0
    settle(s)
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
    if (end > start) {
      const last = s.parts.at(-1)
      const offset = start - (last?.count || 0)
      const extended = slice(s.text, tokens, offset, end)
      if (last?.provisional && !last.forced && sentences(extended).length === 1 && words(extended).length <= 40) {
        const meta = metadata(s, offset, end)
        revise(last.id, extended, meta)
        Object.assign(last, { text: extended, count: words(extended).length, ...meta })
        s.committedCharacters = tokens[end - 1].index + tokens[end - 1][0].length
      } else publish(s, start, end)
    }
  }
  function flush(s) {
    s.flushed = true
    clearTimeout(s.timer); timers.delete(s.timer)
    reconcile(s, s.text, s.finals)
    const start = publishedWords(s); const end = words(s.text).length
    if (end > start) publish(s, start, end, true)
    for (const part of s.parts) if (part.provisional && !part.forced) {
      part.forced = true; revise(part.id, part.text, { confidence: undefined, provisional: true, forced: true })
    }
    settle(s)
  }
  function previewCurrent() { preview(current.text.slice(current.committedCharacters).trim()) }
  rec.onstart = rec.onaudiostart = () => { failed = false; clearTimeout(retryTimer); retryTimer = undefined; if (wanted) { state('listening'); message('') } }
  rec.onresult = event => {
    message('')
    const incoming = Array.from(event.results, (result, index) => ({ index, text: result[0].transcript.trim(), final: result.isFinal, confidence: result[0].confidence, alternatives: Array.from(result, a => a.transcript) })).filter(r => r.text)
    if (!incoming.length) return
    failed = false; failures = 0; clearTimeout(retryTimer); retryTimer = undefined
    if (wanted) state('listening')
    const candidate = normalized(incoming.map(r => r.text).join(' ')); const old = normalized(closing?.text || '')
    const overlap = candidate.slice(0, 10).filter(word => old.slice(0, 10).includes(word)).length
    const matchesClosing = closing?.awaitingFinal && incoming[0].final && ((!closing.flushed && !current.text) || overlap >= Math.min(candidate.length, old.length, 10) * .6)
    const target = matchesClosing ? closing : current
    let rows = trackRows(target, incoming).filter(row => !row.saved || !filler(row.text))
    if (filler(rows.filter(row => !row.final).map(row => row.text).join(' '))) rows = rows.filter(row => row.final)
    const text = rows.map(r => r.text).join(' ')
    let count = 0
    const finals = []
    let previousFinal = ''
    for (const row of rows) {
      count += words(row.text).length
      if (!row.final) break
      if (finals.length && !finals.at(-1).saved && unfinishedSpeech(previousFinal) && !row.saved) finals.pop()
      finals.push({ end: count, confidence: Number.isFinite(row.confidence) ? row.confidence : undefined, saved: row.saved, alternatives: row.alternatives.map(numericValues).filter(values => values.length && values.join() !== numericValues(row.text).join()) })
      previousFinal = row.text
    }
    const previous = target.text
    let offset = 0
    for (const row of rows) {
      const end = offset + words(row.text).length
      const values = numericValues(row.text)
      if (row.saved && values.length) risk(target, offset, end, 'interim')
      if (row.alternatives.some(alt => numericValues(alt).join() !== values.join())) risk(target, offset, end, 'alternatives')
      offset = end
    }
    const finalEnd = finals.at(-1)?.end || 0
    const tokens = words(text)
    if (finalEnd === tokens.length) {
      for (const observation of target.observations) {
        const end = finals.find(range => range.end > observation.start)?.end || finalEnd
        if (missing(observation.values, numericValues(slice(text, tokens, Math.min(observation.start, end), end)))) risk(target, observation.start, end, 'interim')
      }
      target.observations = []
    } else {
      const values = numericValues(slice(text, tokens, finalEnd, tokens.length))
      if (values.length && !target.observations.some(o => o.start === finalEnd && o.values.join() === values.join())) target.observations.push({ start: finalEnd, values })
    }
    if (target.afterRestart && numericValues(rows[0]?.text || '').length) risk(target, 0, words(rows[0].text).length, 'boundary')
    reconcile(target, text, finals)
    if (target === closing) { clearTimeout(target.timer); timers.delete(target.timer); target.timer = later(() => flush(target)); return }
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
      immediateRetry = event.error === 'network' && failures === 0
      if (immediateRetry) state('retrying')
      else scheduleRetry()
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
    if (wanted && failed && immediateRetry) { immediateRetry = false; failures++; startRecognition() }
    else if (wanted && failed) scheduleRetry()
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
    start() { wanted = true; failed = false; failures = 0; immediateRetry = false; clearTimeout(retryTimer); retryTimer = undefined; message(''); startRecognition() },
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
