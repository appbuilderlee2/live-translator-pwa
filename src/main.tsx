import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { traditional } from '../shared/traditional.mjs'
import { networkTranslation } from './network.mjs'
import { numericMismatch, splitText, recoverSegment, retryableSegments, previousContext, patchSegment } from './transcript.mjs'
import { createSpeechController } from './speech.mjs'
import { speakTranslation } from './voice.mjs'
import '@fontsource/noto-sans-tc/400.css'
import './style.css'
import './accessibility.css'

type Segment = { id: string; en: string; zh: string; timestamp: number; confidence?: number; forced?: boolean; status: 'pending' | 'translating' | 'done' | 'error' }
type Session = { id: string; timestamp: number; segments: Segment[] }
type Recognition = { start(): void; stop(): void }
type Translator = { translate(text: string): Promise<string> }
declare global { interface Window { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition; Translator?: { availability(options: object): Promise<string>; create(options: object): Promise<Translator> } } }
function load<T,>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback } }
const uid = () => crypto.randomUUID()
const speechSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition)
let devicePromise: Promise<Translator | null> | undefined
function device() {
  if (!devicePromise) devicePromise = (async () => {
    if (!('Translator' in self) || !window.Translator) return null
    const options = { sourceLanguage: 'en', targetLanguage: 'zh-Hant' }
    try {
      if (await window.Translator.availability(options) === 'unavailable') return null
      return await Promise.race([window.Translator.create(options), new Promise<null>(resolve => setTimeout(() => resolve(null), 1500))])
    } catch { return null }
  })()
  return devicePromise
}
async function translate(text: string, signal: AbortSignal, update: (text: string) => void, context: { en: string; zh: string }[] = []) {
  const local = await device()
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (local) {
    try {
      const result = await Promise.race([local.translate(text), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('On-device translation timed out')), 5000))])
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const zh = traditional(result); update(zh); return zh
    } catch { if (signal.aborted) throw new DOMException('Aborted', 'AbortError') }
  }
  if (!navigator.onLine) throw new Error('offline')
  return networkTranslation(text, signal, update, context)
}
function App() {
  const [segments, setSegments] = useState<Segment[]>(() => load<Segment[]>('lt-current', []).map(recoverSegment))
  const [history, setHistory] = useState<Session[]>(() => load<Session[]>('lt-history', []).map(s => ({ ...s, segments: s.segments.map(recoverSegment) })))
  const [historyOpen, setHistoryOpen] = useState(false); const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = history.find(s => s.id === selectedId)
  const [online, setOnline] = useState(navigator.onLine); const [micState, setMicState] = useState('idle'); const [input, setInput] = useState('')
  const mic = micState === 'listening'
  const [interim, setInterim] = useState(''); const [preview, setPreview] = useState(''); const [message, setMessage] = useState('')
  const [autoSpeak, setAutoSpeak] = useState(() => load('lt-auto-speak', false)); const [font, setFont] = useState(() => { const value = load('lt-font', 28); return typeof value === 'number' ? Math.min(42, Math.max(20, value)) : 28 }); const [localReady, setLocalReady] = useState(false)
  const [voiceChoice, setVoiceChoice] = useState<string>(() => load('lt-voice', 'zh-TW'))
  const [rate, setRate] = useState<number>(() => { const saved = load('lt-rate', 1); return [.8, 1, 1.2].includes(saved) ? saved : 1 })
  const [largeUI, setLargeUI] = useState(() => load('lt-large-ui', false))
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const composer = useRef<HTMLTextAreaElement>(null)
  const [announcement, setAnnouncement] = useState(''); const [deleted, setDeleted] = useState<Session | null>(null)
  const speech = useRef<ReturnType<typeof createSpeechController> | null>(null); const autoRef = useRef(false)
  const active = useRef(new Map<string, AbortController>()); const bottom = useRef<HTMLDivElement>(null); const segmentsRef = useRef(segments); const historyRef = useRef(history)
  autoRef.current = autoSpeak
  useEffect(() => { if (composer.current) { composer.current.style.height = 'auto'; composer.current.style.height = `${Math.min(120, composer.current.scrollHeight)}px` } }, [input])
  function changeSegments(fn: (items: Segment[]) => Segment[]) { segmentsRef.current = fn(segmentsRef.current); setSegments(segmentsRef.current) }
  function changeHistory(fn: (items: Session[]) => Session[]) { historyRef.current = fn(historyRef.current); setHistory(historyRef.current) }
  function speak(text: string) { void speakTranslation(text, window.speechSynthesis, window.SpeechSynthesisUtterance, setMessage, { choice: voiceChoice, rate }) }
  const speakRef = useRef(speak); speakRef.current = speak
  useEffect(() => {
    const synth = window.speechSynthesis; if (!synth) return
    const update = () => setVoices(synth.getVoices().filter(v => /^zh(?:-|_)/i.test(v.lang)))
    update(); synth.addEventListener('voiceschanged', update)
    return () => synth.removeEventListener('voiceschanged', update)
  }, [])
  useEffect(() => {
    try { localStorage.setItem('lt-auto-speak', JSON.stringify(autoSpeak)); localStorage.setItem('lt-voice', JSON.stringify(voiceChoice)); localStorage.setItem('lt-rate', JSON.stringify(rate)); localStorage.setItem('lt-large-ui', JSON.stringify(largeUI)) } catch { /* Preferences are optional when storage is unavailable. */ }
  }, [autoSpeak, voiceChoice, rate, largeUI])
  useEffect(() => { try { localStorage.setItem('lt-font', JSON.stringify(font)) } catch { /* Preference is optional when storage is unavailable. */ } }, [font])
  useEffect(() => { if (!deleted) return; const timer = setTimeout(() => setDeleted(null), 7000); return () => clearTimeout(timer) }, [deleted])
  useEffect(() => { try { localStorage.setItem('lt-current', JSON.stringify(segments)) } catch { setMessage('儲存空間已滿或無法使用，請下載逐字稿以保留內容。Storage is full or unavailable. Download your transcript to keep it.') } }, [segments])
  useEffect(() => { try { localStorage.setItem('lt-history', JSON.stringify(history)) } catch { setMessage('無法儲存歷史紀錄，請下載逐字稿。Could not save history. Download your transcript instead.') } }, [history])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [segments, preview])
  async function run(segment: Segment) {
    if (active.current.has(segment.id)) return
    const controller = new AbortController(); active.current.set(segment.id, controller)
    const update = (patch: Partial<Segment>) => {
      changeSegments(items => patchSegment(items, segment.id, patch))
      changeHistory(items => items.map(session => ({ ...session, segments: patchSegment(session.segments, segment.id, patch) })))
    }
    const context = previousContext(segment.id, segmentsRef.current, historyRef.current)
    update({ status: 'translating' })
    try { const zh = await translate(segment.en, controller.signal, zh => update({ zh }), context); update({ zh, status: 'done' }); setAnnouncement(`${segment.en}. ${zh}`); if (autoRef.current && segmentsRef.current.some(s => s.id === segment.id)) speakRef.current(zh) }
    catch { if (!controller.signal.aborted) { const pending = !navigator.onLine; update({ status: pending ? 'pending' : 'error' }); setAnnouncement(pending ? '英文已保留，連線後自動翻譯。English saved; translation resumes online.' : '翻譯中斷，請重新翻譯。Translation interrupted; please retry.'); if (!pending) setMessage('翻譯中斷，英文已保留，請按「重新翻譯」。Translation interrupted. Your English is saved; tap Retry translation.') } }
    finally { active.current.delete(segment.id) }
  }
  function commit(text: string, metadata: { confidence?: number; forced?: boolean } = {}) {
    const en = text.trim(); if (!en) return
    setSelectedId(null); setHistoryOpen(false)
    for (const part of splitText(en)) {
      const segment: Segment = { id: uid(), en: part, zh: '', timestamp: Date.now(), status: 'pending', ...metadata }
      changeSegments(items => [...items, segment]); void run(segment)
    }
    setInterim(''); setPreview('')
  }
  const commitRef = useRef(commit); commitRef.current = commit
  useEffect(() => {
    const resume = () => { for (const s of retryableSegments(segmentsRef.current, historyRef.current)) void run(s) }
    const reconnect = () => { setOnline(true); resume() }
    const disconnect = () => setOnline(false)
    window.addEventListener('online', reconnect); window.addEventListener('offline', disconnect)
    resume()
    return () => { window.removeEventListener('online', reconnect); window.removeEventListener('offline', disconnect) }
  }, [])
  useEffect(() => {
    if (!interim.trim()) { setPreview(''); return }
    const controller = new AbortController()
    const timer = setTimeout(() => { void translate(interim.slice(0, 2000), controller.signal, text => { if (!controller.signal.aborted) setPreview(text) }, segmentsRef.current.slice(-2).map(({ en, zh }) => ({ en, zh }))).catch(() => {}) }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [interim])
  useEffect(() => {
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Constructor) return
    const controller = createSpeechController(new Constructor(), { commit: (text: string, metadata: { confidence?: number; forced?: boolean }) => commitRef.current(text, metadata), preview: setInterim, state: setMicState, message: setMessage })
    speech.current = controller
    return () => controller.dispose()
  }, [])
  function toggleMic() {
    if (micState !== 'idle') speech.current?.stop()
    else { setSelectedId(null); setHistoryOpen(false); void device().then(t => setLocalReady(!!t)); speech.current?.start() }
  }
  async function newSession() {
    await speech.current?.finish()
    const saved = segmentsRef.current
    if (saved.length) changeHistory(items => [{ id: uid(), timestamp: Date.now(), segments: saved }, ...items])
    changeSegments(() => []); setInput(''); setInterim(''); setPreview(''); setSelectedId(null); setHistoryOpen(false); setMessage('')
  }
  function deleteSession(session: Session) {
    setDeleted(session); changeHistory(items => items.filter(s => s.id !== session.id)); if (selectedId === session.id) setSelectedId(null)
  }
  function undoDelete() {
    if (!deleted) return
    const restored = { ...deleted, segments: deleted.segments.map(recoverSegment) }
    changeHistory(items => [restored, ...items].sort((a, b) => b.timestamp - a.timestamp)); setDeleted(null)
    for (const s of restored.segments) if ((s.status === 'pending' || s.status === 'error') && !active.current.has(s.id)) void run(s)
  }
  const shown = selected?.segments || segments
  const transcript = shown.map(s => `${new Date(s.timestamp).toLocaleString()}\n${s.en}\n${s.zh || '[等待翻譯 / Pending translation]'}`).join('\n\n')
  function download() { const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'live-translator-transcript.txt'; a.click(); URL.revokeObjectURL(url) }
  return <div className={`app ${largeUI ? 'large-ui' : ''}`}>
    <header><a className="brand" href="/" aria-label="即時翻譯首頁 / Live Translator home"><span className="logo">譯</span><span>Live Translator<small>即時翻譯 · 理解彼此</small></span></a><span className={`connection ${online ? '' : 'offline'}`}><i />{online ? '連線 Online' : '離線 Offline'}</span></header>
    <main>
      <div className="heading"><div><div className="eyebrow">一句一句，拉近距離 · ONE WORD AT A TIME</div><h1>對話，不再有隔閡<span>。</span></h1><p>說英文，即時看繁體中文。<br/>Speak English. Connect in Traditional Chinese.</p></div><span className="decor" aria-hidden="true">你好<span>hello</span></span></div>
      <div className="workspace">
        <div className="toolbar"><div className="languages"><span><b>EN</b> 英文 English</span><span className="arrow">→</span><span><b>繁</b> 繁體中文 <small>TW Chinese</small></span></div><button className="quiet" aria-expanded={historyOpen} aria-controls="history" onClick={() => { setHistoryOpen(!historyOpen); setSelectedId(null) }}>◷ <span>歷史 History</span>{history.length > 0 && <em>{history.length}</em>}</button></div>
        <div className="sessionbar"><span><i className={mic ? 'live-dot' : ''} />{selected ? '已存對話 / SAVED' : micState === 'requesting' ? '等待麥克風 / REQUESTING MIC' : mic ? '收音中 / LISTENING' : '目前對話 / CURRENT'} <small> / {shown.length} 段 segments</small></span><div className="fontcontrol"><label htmlFor="font">字級 Size</label><input aria-label="字幕字級 / Subtitle font size" id="font" type="range" min="20" max="42" value={font} onChange={e => setFont(Number(e.target.value))} /><span>Aa</span></div></div>
        {historyOpen && <section className="history" id="history"><h2>您的對話 / Your conversations</h2>{history.length === 0 ? <p>尚未儲存對話，請按下方「儲存／新對話」。No saved sessions yet. Save a conversation below.</p> : history.map(session => <div className="history-row" key={session.id}><button onClick={() => setSelectedId(session.id)}>{new Date(session.timestamp).toLocaleString()}<small>{session.segments.length} 段 segments · {session.segments[0]?.en.slice(0, 44)}</small></button><button aria-label={`刪除對話 / Delete session: ${new Date(session.timestamp).toLocaleString()}`} onClick={() => deleteSession(session)}>刪除 Delete</button></div>)}{selected && <button onClick={() => { setSelectedId(null); setHistoryOpen(false) }}>← 返回目前對話 / Back to live session</button>}</section>}
        <section className="subtitles" aria-label="雙語字幕 / Bilingual subtitles" style={{ '--subtitle-size': `${font}px` } as React.CSSProperties}>
          {!shown.length && !interim && <div className="empty"><div className="wave" aria-hidden="true">{[14, 26, 40, 22, 50, 32, 18, 36, 24].map((h, i) => <i key={i} style={{ height: h }} />)}</div><h2>{micState === 'requesting' ? '等待麥克風授權 / Requesting microphone…' : mic ? '已開始收音，請說話。You’re on. Say hello.' : '從一句話，開始理解。Start a conversation.'}</h2><p>{micState === 'requesting' ? '請在瀏覽器提示中選擇「允許」。Allow microphone access in your browser.' : mic ? '英文與中文翻譯將顯示在這裡。Your words and translation appear here.' : '按麥克風並允許權限，或在下方輸入英文。\nTap the microphone and allow access, or type English below.'}</p><span className="empty-tag">英文 ENGLISH <span>→</span> 繁體中文</span></div>}
          {shown.map((s, index) => <article className="segment" key={s.id}><div className="segment-meta"><span>{String(index + 1).padStart(2, '0')}</span><time>{new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>{s.status === 'pending' ? '已保留，等待連線 / Waiting for connection' : s.status === 'translating' ? '翻譯中 / Translating…' : s.status === 'error' ? '翻譯中斷 / Interrupted' : '✓ 翻譯完成 / Translated'}</span></div>
            <div className="quality">{s.confidence !== undefined && <span>辨識信心 / Confidence: {Math.round(s.confidence * 100)}%</span>}{(s.forced || (s.confidence !== undefined && s.confidence < .8) || (s.status === 'done' && numericMismatch(s.en, s.zh))) && <span className="check">⚠ 請核對 Check: {s.status === 'done' && numericMismatch(s.en, s.zh) ? '數字可能不符 / figures may not match' : s.forced ? '暫存語音，請確認內容 / interim speech saved' : '辨識信心較低 / low speech confidence'}</span>}</div>
            <p className="english" lang="en">{s.en}</p><button className="chinese" lang="zh-TW" aria-label={`朗讀譯文 / Read translation: ${s.zh}`} title="朗讀譯文 / Replay translation" onClick={() => speak(s.zh)} disabled={!s.zh}>{s.zh || (s.status === 'pending' ? '等待連線…' : s.status === 'error' ? '翻譯暫時無法使用' : '翻譯中…')}<span> ↗</span></button>{(s.status === 'pending' || s.status === 'error') && <button className="retry" onClick={() => void run(s)}>↻ 重新翻譯 / Retry translation</button>}</article>)}
          {interim && !selected && <article className="segment preview"><div className="segment-meta">即時預覽 / LIVE PREVIEW</div><p className="english" lang="en">{interim}</p><p className="chinese" lang="zh-TW">{preview || '…'}</p></article>}<div ref={bottom} />
        </section>
        <div className="transcript-actions"><span>↗ 點譯文即可朗讀 / Tap translation to listen</span><div>{shown.length > 0 && <><button onClick={() => void navigator.clipboard.writeText(transcript).then(() => setMessage('已複製逐字稿。Transcript copied.')).catch(() => setMessage('無法複製，請改用下載。Copy unavailable. Use Download instead.'))}>複製 Copy</button><button onClick={download}>下載 Download .txt</button></>}<button onClick={() => void newSession()} disabled={!segments.length && !interim && !input}>儲存／新對話 Save / New ↗</button></div></div>
      </div>
      {!speechSupported && <p className="notice">此瀏覽器不支援語音辨識，請輸入英文，或改用 Chrome、Edge、Safari。Speech recognition isn’t available. Type English below or use Chrome, Edge or Safari.</p>}
      <div className="notifications">{message && <div className="notice" role="status">{message}<button onClick={() => setMessage('')} aria-label="關閉訊息 / Dismiss message">×</button></div>}
      {deleted && <div className="notice" role="status">已刪除對話 / Session deleted.<button onClick={undoDelete}>復原 Undo</button></div>}</div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div><div className="sr-only" role="status">{micState === 'requesting' ? '等待麥克風授權 / Requesting microphone' : mic ? '收音中 / Listening' : '麥克風已關閉 / Microphone off'}. {online ? '連線 / Online' : '離線 / Offline'}</div>
      <div className="bottom-bar"><form className="inputbox" onSubmit={e => { e.preventDefault(); commit(input); setInput(''); setSelectedId(null); setHistoryOpen(false); void device().then(t => setLocalReady(!!t)) }}><label className="sr-only" htmlFor="english">輸入英文翻譯，長文將自動分段。Type English; long text is split into segments.</label><textarea ref={composer} id="english" rows={2} value={input} onChange={e => setInput(e.target.value)} placeholder="在此輸入英文 / Type English here…" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} /><button type="submit" disabled={!input.trim()} aria-label="翻譯輸入文字 / Translate message">↑</button></form>
      <p className="input-hint">按 Enter 翻譯；Shift+Enter 換行。Enter to translate; Shift+Enter for a new line.</p>
      {input.length > 2000 && <p className="input-hint" role="status">共 {input.length.toLocaleString()} 字元，將完整分為 {splitText(input).length} 段。Characters will be split into segments; no text is cut.</p>}
      <div className="controls"><label className="speak-toggle"><input type="checkbox" checked={autoSpeak} onChange={e => { setAutoSpeak(e.target.checked); if (e.target.checked) speak('語音已開啟') }} /><span className="switch"/><span>朗讀譯文<small>Speak translations</small></span></label><div className="mic-group"><button className={`mic ${mic ? 'recording' : ''}`} disabled={!speechSupported} onClick={toggleMic} aria-label={micState !== 'idle' ? '停止收音 / Stop microphone' : '開始收音 / Start microphone'}>{mic ? <span className="stop-icon"/> : <svg width="24" height="28" viewBox="0 0 24 28" fill="none" aria-hidden="true"><rect x="8" y="2" width="8" height="15" rx="4" stroke="currentColor" strokeWidth="2"/><path d="M4 12v2a8 8 0 0016 0v-2M12 22v4M8 26h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>}</button><span>{micState === 'requesting' ? '等待授權 / Requesting microphone…' : mic ? '按一下停止 / Tap to stop' : '按一下開始說英文 / Tap to speak English'}</span></div><div className="privacy"><span>◈ {localReady ? '裝置內翻譯 / On-device' : '即時理解 / In the moment'}</span><small>{localReady ? '可離線使用 / READY OFFLINE' : '不必註冊 / NO ACCOUNT NEEDED'}</small></div></div>
      </div><section className="preferences" aria-label="無障礙與語音設定 / Accessibility and voice settings">
        <label>朗讀語音 / Voice<select aria-label="朗讀語音 / Voice" value={voiceChoice} onChange={e => setVoiceChoice(e.target.value)}><option value="zh-TW">台灣華語 / Taiwan Mandarin {voices.some(v => /^zh-TW$/i.test(v.lang)) ? '' : '（未安裝 / Not installed）'}</option><option value="zh-HK">香港粵語 / HK Cantonese {voices.some(v => /^zh-HK$/i.test(v.lang)) ? '' : '（未安裝 / Not installed）'}</option>{voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}{!['zh-TW', 'zh-HK'].includes(voiceChoice) && !voices.some(v => v.voiceURI === voiceChoice) && <option value={voiceChoice}>所選語音未安裝 / Selected voice not installed</option>}</select></label>
        <label>朗讀速度 / Speed<select aria-label="朗讀速度 / Speed" value={rate} onChange={e => setRate(Number(e.target.value))}><option value={.8}>慢 / Slow</option><option value={1}>正常 / Normal</option><option value={1.2}>快 / Fast</option></select></label>
        <label className="large-setting"><input type="checkbox" checked={largeUI} onChange={e => setLargeUI(e.target.checked)} />放大介面文字 / Large interface text</label>
      </section>
      <details className="mic-help"><summary>麥克風設定說明 / Microphone help</summary><p>開始前：按麥克風，出現提示時選「允許」。需要 HTTPS（本機 localhost 除外）。也可以隨時在上方輸入英文。Before speaking: tap the mic and choose Allow. HTTPS is required except on localhost. You can always type English above.</p><ol><li>電腦 Chrome / Edge：網址左側的網站設定圖示 → 網站設定 → 麥克風「允許」→ 重新整理 → 再按麥克風。Desktop Chrome / Edge: site controls beside address → Site settings → Microphone → Allow → reload → tap mic.</li><li>Android Chrome：網址左側圖示 → 權限 → 麥克風「允許」。若仍無法使用：Android 設定 → 應用程式 → Chrome → 權限 → 麥克風 → 使用時允許，再重新整理。Android: site controls → Permissions → Microphone → Allow. Also check Android Settings → Apps → Chrome → Permissions → Microphone → Allow while using; reload.</li><li>iPhone / iPad Safari：網址旁的頁面選單（aA 或圖示）→ 網站設定 → 麥克風 → 允許。再檢查「設定 → App → Safari → 麥克風」（舊版在「設定 → Safari」），重新整理後再按麥克風。iOS Safari: Page menu → Website Settings → Microphone → Allow. Check Settings → Apps → Safari → Microphone (older iOS: Settings → Safari), reload and tap mic.</li><li>Mac Safari：Safari → 設定 → 網站 → 麥克風 → 此網站選「允許」。再到系統設定 → 隱私權與安全性 → 麥克風 → 開啟 Safari，重新整理。Mac Safari: Settings → Websites → Microphone → Allow. Also enable Safari in System Settings → Privacy & Security → Microphone, then reload.</li></ol></details>
    </main><footer><span>讓世界更懂彼此。Made for understanding.</span><a href="https://app.devin.ai/sessions/aa4435ec5490439f866a5c005af82a75" target="_blank" rel="noreferrer">提出修改 Request changes ↗</a></footer>
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
