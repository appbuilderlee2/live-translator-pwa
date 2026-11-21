export function createSpeechController(rec, { commit, preview, state, message }) {
  rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'; rec.maxAlternatives = 3
  let wanted = false; let stopping = false; let running = false; let draft = ''; let pause; let age; let restart
  const pending = new Map(); const finalized = new Set(); const waiters = []
  const clearTimers = () => { clearTimeout(pause); clearTimeout(age); pause = undefined; age = undefined }
  const flush = () => {
    clearTimers()
    for (const [index, result] of pending) { if (!finalized.has(index)) { finalized.add(index); commit(result.text, { confidence: result.confidence, forced: true }) } }
    pending.clear(); draft = ''; preview('')
  }
  const boundary = () => { if (!stopping && pending.size) { stopping = true; rec.stop() } }
  rec.onstart = rec.onaudiostart = () => { if (wanted) state('listening') }
  rec.onresult = event => {
    message('')
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      if (finalized.has(i)) continue
      const confidence = Number.isFinite(result[0].confidence) ? result[0].confidence : undefined
      if (result.isFinal) { finalized.add(i); pending.delete(i); commit(result[0].transcript, { confidence, forced: false }) }
      else pending.set(i, { text: result[0].transcript, confidence })
    }
    const next = [...pending.values()].map(s => s.text).join(' ').trim()
    if (next !== draft) {
      draft = next; clearTimeout(pause)
      if (next) pause = setTimeout(boundary, 1200)
    }
    preview(next)
    if (next && !age) age = setTimeout(boundary, 5000)
    if (!next) clearTimers()
    if (next.split(/\s+/).length > 25 || next.length > 1800) boundary()
  }
  rec.onerror = event => {
    if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
      wanted = false; state('idle'); message(`無法使用麥克風（${event.error}）。請依下方「麥克風設定說明」允許權限，或改用英文輸入。Microphone ${event.error}. Follow Microphone help below to allow access, or type English.`)
    } else if (event.error === 'no-speech') message('未偵測到語音，請靠近麥克風再說一次。No speech detected. Try speaking closer to your microphone.')
    else if (event.error !== 'aborted') message(`語音辨識錯誤（${event.error}），仍可輸入英文翻譯。Speech recognition: ${event.error}. You can still type below.`)
  }
  rec.onend = () => {
    flush(); finalized.clear(); stopping = false; running = false; state(wanted ? 'requesting' : 'idle')
    for (const resolve of waiters.splice(0)) resolve()
    if (wanted) restart = setTimeout(startRecognition, 150)
  }
  function startRecognition() {
    try { state('requesting'); running = true; rec.start() } catch { running = false; wanted = false; state('idle'); message('無法啟動麥克風，請再按一次或改用輸入。Could not start microphone. Tap to try again or type instead.') }
  }
  return {
    start() { wanted = true; message(''); startRecognition() },
    stop() {
      wanted = false; clearTimeout(restart)
      if (running && !stopping) { stopping = true; try { rec.stop() } catch { flush(); stopping = false; running = false } }
      state('idle')
    },
    async finish() {
      this.stop()
      if (!running) return
      await new Promise(resolve => { const timer = setTimeout(() => { flush(); resolve() }, 700); waiters.push(() => { clearTimeout(timer); resolve() }) })
    },
    dispose() { wanted = false; clearTimers(); clearTimeout(restart); rec.onend = null; rec.onresult = null; rec.onstart = null; rec.onaudiostart = null; rec.onerror = null; rec.stop() }
  }
}
