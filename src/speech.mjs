import { numericValues, splitText, unfinishedSpeech, sameRecognizedSource } from './transcript.mjs'
import { speechEvidence } from './diagnostics.mjs'

const words = text => [...text.matchAll(/\S+/g)]
const normalized = text => words(text).map(w => w[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
const filler = text => /^(?:a|an|the|um|uh|er|ah|and|or|but|to|of|in|on|at|for|with|is|are|was|were|be|been|can)$/i.test(normalized(text).join(' '))
const slice = (text, tokens, start, end) => end > start ? text.slice(tokens[start].index, tokens[end - 1].index + tokens[end - 1][0].length) : ''
function phraseBoundary(text, tokens, start, end, limit = tokens.length) {
  while (end < limit && end - start < 40 && (unfinishedSpeech(slice(text, tokens, start, end)) || /\b(?:a|an|the)\s+better$/i.test(slice(text, tokens, start, end)))) end++
  return end
}
function clauseBoundary(text, tokens, start) {
  const candidates = []
  for (let end = start + 12; end < tokens.length; end++) {
    const before = slice(text, tokens, start, end)
    if (/\b(?:that|if|when|because|whether|know|think|believe|hope|wish|said|says|see|ensure|and|but|or|by|while|through|for)\s*$/i.test(before)) continue
    if (/^(?:we\s+(?:are|have|need|can|will|change|keep|record|discuss)\b|this\s+is\b|(?:a|the)\s+(?:[a-z-]+\s+){0,3}result\s+is\b|recording\s+(?:the\s+)?results?\s+carefully\b)/i.test(text.slice(tokens[end].index))) candidates.push(end)
  }
  return candidates.find(end => end - start >= 30 && end - start <= 40) || candidates.filter(end => end - start <= 40).at(-1) || candidates[0] || tokens.length
}
function sentences(text) {
  return text.split(/(?<=[.!?])\s+/).flatMap(s => splitText(s)).flatMap(s => {
    const tokens = words(s)
    if (tokens.length <= 40) return [s]
    const chunks = []
    for (let start = 0; start < tokens.length;) {
      const end = tokens.length - start <= 40 ? tokens.length : clauseBoundary(s, tokens, start)
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
let sessionId = 0
function session() { return { id: ++sessionId, text: '', rows: [], retained: [], parts: [], finals: [], committedCharacters: 0, timer: undefined, awaitingFinal: false, flushed: false, observations: [], risks: [], afterRestart: false } }
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

export function createSpeechController(rec, { commit, revise = (_id, _text, _meta) => {}, preview, state, message, settling = (_pending) => {}, canRevise = (_id) => false, isDispatched = (_id) => false }) {
  rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'; rec.maxAlternatives = 3
  let wanted = false; let running = false; let nativeStarted = false; let current = session(); let closing; let pause
  let retryTimer; let failures = 0; let failed = false; let immediateRetry = false
  const timers = new Set()
  const endedSessions = new Set()
  const later = fn => {
    const timer = setTimeout(() => { timers.delete(timer); fn() }, 250)
    timers.add(timer)
    return timer
  }
  const metadata = (s, start, end, saved = false) => {
    const final = s.finals.find(range => end <= range.end)
    const uncertain = !final || !!final.saved
    return { ...speechEvidence(s, start, end), confidence: final?.confidence, numericAlternatives: final?.alternatives || [], unconfirmed: !!s.terminal && uncertain, provisional: !s.terminal && uncertain || !s.flushed && end === words(s.text).length && unfinishedSpeech(slice(s.text, words(s.text), start, end)), forced: !s.terminal && (!!final?.saved || !final && saved), numericWarnings: [...new Set(s.risks.filter(r => r.start < end && r.end > start).map(r => r.reason))] }
  }
  const publishedWords = s => s.parts.reduce((sum, p) => sum + p.count, 0)
  const notifySettlement = () => settling([...endedSessions, current].some(s => s.terminal && (s.parts.some(part => !part.ignored && !part.settled) || words(s.text).length > publishedWords(s))))
  function awaitTerminalFinal(s) {
    if (!s.terminal) return
    s.quietUntil = Date.now() + 250
    for (const part of s.parts) if (!part.ignored && canRevise(part.id)) {
      clearTimeout(part.settleTimer); timers.delete(part.settleTimer); part.settleTimer = undefined
      if (part.settled) { part.settled = false; revise(part.id, part.text, { settled: false }) }
    }
    clearTimeout(s.timer); timers.delete(s.timer)
    s.timer = later(() => flush(s))
    notifySettlement()
  }
  function settle(s) {
    for (const part of s.parts) {
      if (part.ignored || part.settled || part.provisional || part.forced || part.settleTimer) continue
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
        const ignored = filler(text)
        s.parts.push({ id: ignored ? undefined : commit(text, { ...meta, settled: false }), text, count, ...meta, ignored, settled: ignored })
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
    const complete = finals.at(-1)
    if (complete && !complete.saved && complete.end === tokens.length) {
      const finalStart = finals.at(-2)?.end || 0
      let first = s.parts.length; let start = publishedWords(s)
      while (first > 0) {
        const part = s.parts[first - 1]
        if (start - part.count < finalStart || isDispatched(part.id) || part.settled && !part.provisional && !part.forced && !canRevise(part.id)) break
        start -= part.count; first--
      }
      const part = s.parts[first]
      const prior = normalized(s.parts.slice(first).map(p => p.text).join(' '))
      if (part && !part.ignored && s.parts.slice(first + 1).every(tail => tail.ignored || canRevise(tail.id)) && prior.every((word, i) => word === next[start + i])) {
        const planned = sentences(slice(text, tokens, start, complete.end))
        if (planned.length && s.parts.slice(first).map(p => p.text).join('\n') !== planned.join('\n')) {
          for (const tail of s.parts.splice(first + 1)) {
            clearTimeout(tail.settleTimer); timers.delete(tail.settleTimer)
            if (!tail.ignored) revise(tail.id, '', {})
          }
          clearTimeout(part.settleTimer); timers.delete(part.settleTimer); part.settleTimer = undefined
          const en = planned[0]; const meta = metadata(s, start, start + words(en).length)
          revise(part.id, en, { ...meta, settled: false })
          Object.assign(part, { text: en, count: words(en).length, ...meta, settled: false })
        }
      }
    }
    const last = s.parts.findLastIndex(part => !part.ignored)
    let join = last
    if (last > 0 && s.parts[last].count <= 3 && canRevise(s.parts[last].id) && !s.parts[last - 1].ignored && canRevise(s.parts[last - 1].id)) join--
    const part = s.parts[join]
    const start = s.parts.slice(0, join).reduce((sum, p) => sum + p.count, 0)
    const final = finals.at(-1)
    const extension = (final?.end || 0) - start - (part?.count || 0)
    if (part && canRevise(part.id) && final && !finals.some(range => range.saved && range.end > start) && final.end === tokens.length && extension > 0 && extension <= 3 && part.count + extension <= 40 && !/[.!?]["')\]]?$/.test(part.text) && normalized(part.text).every((word, i) => word === next[start + i])) {
      for (const tail of s.parts.splice(join + 1)) {
        clearTimeout(tail.settleTimer); timers.delete(tail.settleTimer)
        if (!tail.ignored) revise(tail.id, '', {})
      }
      clearTimeout(part.settleTimer); timers.delete(part.settleTimer); part.settleTimer = undefined
      const meta = metadata(s, start, final.end)
      const en = slice(text, tokens, start, final.end)
      revise(part.id, en, { ...meta, settled: false })
      Object.assign(part, { text: en, count: final.end - start, ...meta, settled: false })
    }
    let offset = 0
    for (const [index, part] of s.parts.entries()) {
      if (isDispatched(part.id)) { offset += part.count; continue }
      let end = Math.min(offset + part.count, tokens.length)
      const final = finals.find(range => offset + part.count <= range.end) || finals.find(range => offset < range.end)
      if (index === s.parts.length - 1 && final) {
        const completed = sentences(slice(text, tokens, offset, final.end))[0]
        if (completed) end = offset + words(completed).length
      }
      if (end > offset && end < tokens.length && /^please[,;:]?$/i.test(tokens[end - 1][0])) end--
      if (part.provisional && final && !final.saved) end = phraseBoundary(text, tokens, offset, end, final.end)
      if (part.ignored && index === s.parts.length - 1) end = tokens.length
      const original = normalized(part.text)
      const remaining = next.slice(offset)
      const preserved = s.terminal && part.settled && !part.ignored && original.slice(0, Math.min(original.length, remaining.length)).every((word, i) => word === remaining[i])
      if (preserved) end = offset + part.count
      const replacement = slice(text, tokens, offset, end)
      const meta = metadata(s, offset, end, part.forced)
      const extended = final?.saved && normalized(replacement).slice(0, part.count).join() === normalized(part.text).join()
      const accepted = preserved || meta.provisional && !extended ? part.text : replacement
      const settled = part.settled && sameRecognizedSource(part.text, accepted) && !meta.provisional
      if (part.text !== accepted || part.provisional !== meta.provisional) { clearTimeout(part.settleTimer); timers.delete(part.settleTimer); part.settleTimer = undefined }
      if (part.ignored && !filler(accepted) && accepted) { part.id = commit(accepted, { ...meta, settled: false }); part.ignored = false }
      else if (!part.ignored && ((!meta.provisional && matching < end) || part.text !== accepted || part.provisional !== meta.provisional || part.forced !== meta.forced || part.unconfirmed !== meta.unconfirmed || part.confidence !== meta.confidence || part.settled !== settled || part.numericWarnings?.join() !== meta.numericWarnings.join() || JSON.stringify(part.numericAlternatives) !== JSON.stringify(meta.numericAlternatives))) revise(part.id, accepted, { ...meta, settled })
      Object.assign(part, { text: accepted, count: words(accepted).length, ...meta, settled: part.ignored || settled })
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
      if (last?.provisional && !last.ignored && !last.forced && sentences(extended).length === 1) {
        const meta = metadata(s, offset, end)
        revise(last.id, extended, meta)
        Object.assign(last, { text: extended, count: words(extended).length, ...meta })
        s.committedCharacters = tokens[end - 1].index + tokens[end - 1][0].length
      } else publish(s, start, end)
    }
  }
  function flush(s, immediate = false) {
    if (!immediate && s.terminal && s.quietUntil > Date.now()) {
      clearTimeout(s.timer); timers.delete(s.timer)
      const timer = setTimeout(() => { timers.delete(timer); flush(s) }, s.quietUntil - Date.now())
      s.timer = timer; timers.add(timer)
      return
    }
    s.flushed = true
    clearTimeout(s.timer); timers.delete(s.timer)
    reconcile(s, s.text, s.finals)
    const start = publishedWords(s); const end = words(s.text).length
    if (end > start) publish(s, start, end, true)
    if (s.terminal) {
      let offset = 0
      for (const part of s.parts) {
        if (!part.ignored && !part.settled) {
          clearTimeout(part.settleTimer); timers.delete(part.settleTimer); part.settleTimer = undefined
          part.settled = true
          revise(part.id, part.text, { ...metadata(s, offset, offset + part.count), settled: true })
        }
        offset += part.count
      }
    }
    for (const part of s.parts) if (!part.ignored && part.provisional && !part.forced) {
      part.forced = true; revise(part.id, part.text, { confidence: undefined, provisional: true, forced: true })
    }
    settle(s)
    notifySettlement()
  }
  function endListening() {
    const sessions = [...endedSessions, current]
    for (const s of sessions) s.terminal = true
    notifySettlement()
    later(() => { for (const s of sessions) flush(s) })
  }
  function previewCurrent() { preview(current.text.slice(current.committedCharacters).trim()) }
  rec.onstart = () => { nativeStarted = true; clearTimeout(retryTimer); retryTimer = undefined }
  rec.onaudiostart = () => { nativeStarted = true; failed = false; clearTimeout(retryTimer); retryTimer = undefined; if (wanted && !current.terminal) { state('listening'); message('') } }
  rec.onaudioend = () => awaitTerminalFinal(current)
  rec.onresult = event => {
    message('')
    const incoming = Array.from(event.results, (result, index) => ({ index, text: result[0].transcript.trim(), final: result.isFinal, confidence: result[0].confidence, alternatives: Array.from(result, a => a.transcript) })).filter(r => r.text)
    if (!incoming.length) return
    failed = false; failures = 0; clearTimeout(retryTimer); retryTimer = undefined
    if (wanted && !current.terminal) state('listening')
    const candidate = normalized(incoming.map(r => r.text).join(' ')); const old = normalized(closing?.text || '')
    const overlap = candidate.slice(0, 10).filter(word => old.slice(0, 10).includes(word)).length
    const matchesClosing = !nativeStarted && !current.text && !current.terminal && closing?.awaitingFinal && incoming[0].final && ((!closing.flushed && !current.text) || overlap >= Math.min(candidate.length, old.length, 10) * .6)
    const late = !running && !current.text && incoming[0].final ? closing : undefined
    const target = matchesClosing ? closing : late || current
    awaitTerminalFinal(target)
    const tracked = trackRows(target, incoming)
    let rows = tracked.filter((row, index) => !filler(row.text) || row.final && tracked.slice(0, index).some(previous => !filler(previous.text)))
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
    if (target === closing || target === late) { clearTimeout(target.timer); timers.delete(target.timer); target.timer = later(() => flush(target)); return }
    if (text !== previous) { clearTimeout(pause); pause = setTimeout(() => { stable(current, true); previewCurrent() }, 1200) }
    if (words(text).length - publishedWords(current) > 25) stable(current, false, previous)
    previewCurrent()
  }
  rec.onerror = event => {
    if (['not-allowed', 'service-not-allowed'].includes(event.error)) {
      failed = false; immediateRetry = false
      wanted = false; state('idle'); message(`無法使用麥克風（${event.error}）。請依下方「麥克風設定說明」允許權限，或改用英文輸入。Microphone ${event.error}. Follow Microphone help below to allow access, or type English.`)
      endListening()
    } else if (['audio-capture', 'network'].includes(event.error)) {
      if (!wanted) { state('idle'); message(''); return }
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
    if (ended.terminal && wanted) closing = undefined
    else if (ended.text || nativeStarted) closing = ended
    endedSessions.add(ended)
    ended.timer = later(() => flush(ended))
    current = session(); current.afterRestart = ended.awaitingFinal; preview('')
    if (wanted && failed && immediateRetry) { immediateRetry = false; failures++; startRecognition() }
    else if (wanted && failed) scheduleRetry()
    else if (wanted) startRecognition()
    else { if (failed) { failed = false; immediateRetry = false; message('') } state('idle'); endListening() }
  }
  function startRecognition() {
    nativeStarted = false
    try { state(failed ? 'retrying' : 'requesting'); running = true; rec.start() } catch { running = false; failed = true; message('無法啟動麥克風，正在重試。請檢查權限或按「重試麥克風」。Could not start microphone. Retrying; check permissions or Retry mic.'); scheduleRetry() }
  }
  function scheduleRetry() {
    if (!wanted || retryTimer !== undefined) return
    state('retrying')
    retryTimer = setTimeout(() => { retryTimer = undefined; if (wanted) startRecognition() }, Math.min(500 * 2 ** failures++, 5000))
  }
  return {
    start() {
      const fresh = !wanted && current.terminal
      wanted = true; failed = false; failures = 0; immediateRetry = false; clearTimeout(retryTimer); retryTimer = undefined; message('')
      if (fresh) {
        clearTimeout(pause); preview('')
        if (running) { state('requesting'); return }
        endedSessions.add(current)
        current = session(); closing = undefined
      }
      startRecognition()
    },
    stop() {
      wanted = false; clearTimeout(pause); clearTimeout(retryTimer); retryTimer = undefined; state('idle')
      if (failed) message('')
      failed = false; immediateRetry = false
      endListening()
      const stopped = current
      stopped.timer = later(() => flush(stopped))
      if (running) { try { rec.stop() } catch { running = false; flush(stopped) } }
    },
    async finish() { clearTimeout(pause); if (closing) flush(closing, true); flush(current, true); previewCurrent() },
    dispose() { wanted = false; clearTimeout(pause); clearTimeout(retryTimer); for (const timer of timers) clearTimeout(timer); rec.onend = null; rec.onresult = null; rec.onstart = null; rec.onaudiostart = null; rec.onaudioend = null; rec.onerror = null }
  }
}
