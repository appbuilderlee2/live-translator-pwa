import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { negationMismatch } from '../shared/negation.mjs'
import { medicalWarnings } from '../shared/medical.mjs'
import { translateWithFallback } from './local.mjs'
import { networkTranslation } from './network.mjs'
import { numericMismatch, splitText, recoverSegment, retryableSegments, previousContext, translationReady, reviseRecognizedSegment } from './transcript.mjs'
import { captionState } from './translation-state.mjs'
import { createSpeechController } from './speech.mjs'
import { speakTranslation } from './voice.mjs'
import { createTranscriptFollower, jumpLabel } from './follow.mjs'
import { unresolvedTranslations } from './recovery.mjs'
import { createTranslationQueue } from './translation-queue.mjs'
import { formatTranscript, waitForTranslations } from './export.mjs'
import { startServiceWorker } from './pwa.mjs'
import { recognitionWarnings } from './numbers.mjs'
import '@fontsource/noto-sans-tc/400.css'
import './style.css'
import './accessibility.css'

type Segment = { id: string; en: string; zh: string; timestamp: number; confidence?: number; forced?: boolean; provisional?: boolean; settled?: boolean; spoken?: boolean; numericWarnings?: string[]; numericAlternatives?: number[][]; retryable?: boolean; translation?: { source: string; text: string }; status: 'pending' | 'translating' | 'done' | 'error' }
type SpeechMetadata = Pick<Segment, 'confidence' | 'forced' | 'provisional' | 'settled' | 'spoken' | 'numericWarnings' | 'numericAlternatives'>
type Session = { id: string; timestamp: number; segments: Segment[] }
type Recognition = { start(): void; stop(): void }
type Translator = { translate(text: string): Promise<string> }
declare global { interface Window { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition; Translator?: { availability(options: object): Promise<string>; create(options: object): Promise<Translator> } } }
function load<T,>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback } }
const uid = () => crypto.randomUUID()
const speechSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition)
function languageText(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string') return node.split(/([\p{Script=Han}\u3000-\u303f\uff00-\uffef]+)/u).filter(Boolean).map((text, key) => <span data-language key={key} lang={/[\p{Script=Han}]/u.test(text) ? 'zh-Hant-TW' : 'en'}>{text}</span>)
  if (Array.isArray(node)) return node.map(languageText)
  if (!React.isValidElement<{ children?: React.ReactNode; lang?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>(node) || node.props['aria-hidden'] === true || node.props['aria-hidden'] === 'true' || (node.props.lang && node.type !== 'div')) return node
  if (node.type === 'option') return React.cloneElement(node, { lang: 'zh-Hant-TW' })
  return node.props.children === undefined ? node : React.cloneElement(node, {}, languageText(node.props.children))
}
function warnings(segment: Segment, context: { en: string; zh: string }[] = []) {
  const result = recognitionWarnings(segment)
  if (segment.status === 'done' && numericMismatch(segment.en, segment.zh)) result.push('數字可能不符 / figures may not match')
  if (segment.zh && segment.status !== 'translating' && negationMismatch(segment.en, segment.zh)) result.push('否定詞可能遺漏或範圍不符 / negation may be missing or misplaced')
  if (segment.zh && segment.status !== 'translating') result.push(...medicalWarnings(segment.en, segment.zh, context))
  if (!segment.provisional && !segment.forced && segment.confidence !== undefined && segment.confidence < .8) result.push('辨識信心較低 / low speech confidence')
  return result
}
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
async function translate(text: string, signal: AbortSignal, update: (text: string) => void, context: { en: string; zh: string }[] = [], options: { spoken?: boolean; preview?: boolean } = {}) {
  const local = await device()
  return translateWithFallback(local, text, signal, update, context, options, (...args: Parameters<typeof networkTranslation>) => {
    if (!navigator.onLine) throw new Error('offline')
    return networkTranslation(...args)
  })
}
function App() {
  const [segments, setSegments] = useState<Segment[]>(() => load<Segment[]>('lt-current', []).map(recoverSegment))
  const [history, setHistory] = useState<Session[]>(() => load<Session[]>('lt-history', []).map(s => ({ ...s, segments: s.segments.map(recoverSegment) })))
  const [historyOpen, setHistoryOpen] = useState(false); const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = history.find(s => s.id === selectedId)
  const [online, setOnline] = useState(navigator.onLine); const [micState, setMicState] = useState('idle'); const [input, setInput] = useState('')
  const mic = micState === 'listening'
  const [interim, setInterim] = useState(''); const [message, setMessage] = useState('')
  const [translationErrors, setTranslationErrors] = useState<string[]>([])
  const [providerState, setProviderState] = useState({ pending: 0, retryAt: 0, reason: '' })
  const [exporting, setExporting] = useState(false)
  const [micMessage, setMicMessage] = useState('')
  const [autoSpeak, setAutoSpeak] = useState(() => load('lt-auto-speak', false)); const [font, setFont] = useState(() => { const value = load('lt-font', 28); return typeof value === 'number' ? Math.min(42, Math.max(20, value)) : 28 }); const [localReady, setLocalReady] = useState(false)
  const [voiceChoice, setVoiceChoice] = useState<string>(() => load('lt-voice', 'zh-TW'))
  const [rate, setRate] = useState<number>(() => { const saved = load('lt-rate', 1); return [.8, 1, 1.2].includes(saved) ? saved : 1 })
  const [largeUI, setLargeUI] = useState(() => load('lt-large-ui', false))
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const composer = useRef<HTMLTextAreaElement>(null)
  const [announcement, setAnnouncement] = useState(''); const [deleted, setDeleted] = useState<Session | null>(null)
  const [undoSeconds, setUndoSeconds] = useState(15)
  const speech = useRef<ReturnType<typeof createSpeechController> | null>(null); const autoRef = useRef(false)
  const active = useRef(new Map<string, AbortController>()); const transcriptElement = useRef<HTMLElement>(null); const segmentsRef = useRef(segments); const historyRef = useRef(history)
  const follower = useRef(createTranscriptFollower())
  const transcriptContent = useRef<HTMLDivElement>(null)
  const workspaceElement = useRef<HTMLDivElement>(null)
  const bottomBarElement = useRef<HTMLDivElement>(null)
  const view = useRef(selectedId)
  const [followState, setFollowState] = useState({ following: true, unread: 0 })
  const queue = useRef<ReturnType<typeof createTranslationQueue> | null>(null)
  if (!queue.current) queue.current = createTranslationQueue({ find: (id: string) => [...segmentsRef.current, ...historyRef.current.flatMap(s => s.segments)].find(s => s.id === id), execute: (segment: Segment) => execute(segment), storage: localStorage, changed: setProviderState })
  autoRef.current = autoSpeak
  useLayoutEffect(() => {
    const workspace = workspaceElement.current; const bar = bottomBarElement.current
    if (!workspace || !bar) return
    const app = workspace.closest('.app')
    let fixedHeight = 0
    const resize = () => {
      const panel = workspace.getBoundingClientRect(); const controls = bar.getBoundingClientRect()
      if (!app?.classList.contains('reading-flow')) fixedHeight = controls.height
      const chrome = [...workspace.children].filter(child => child.matches('.toolbar, .sessionbar, .transcript-actions')).reduce((height, child) => height + child.getBoundingClientRect().height, 2)
      const cramped = innerHeight - panel.top - scrollY - fixedHeight - chrome - 12 < 180
      app?.classList.toggle('reading-flow', cramped)
      if (cramped || matchMedia('(max-height: 600px)').matches) { workspace.style.height = 'auto'; return }
      const bottom = controls.left >= panel.right ? innerHeight : controls.top
      workspace.style.height = `${Math.max(180, bottom - panel.top - scrollY - 12)}px`
    }
    const observer = new ResizeObserver(resize)
    for (const element of [bar, document.querySelector('header'), document.querySelector('.heading')]) if (element) observer.observe(element)
    for (const element of workspace.children) if (!element.classList.contains('subtitles')) observer.observe(element)
    window.addEventListener('resize', resize); resize()
    return () => { observer.disconnect(); window.removeEventListener('resize', resize) }
  }, [])
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
  useEffect(() => {
    if (!deleted) return
    setUndoSeconds(15)
    const deadline = Date.now() + 15000
    const timer = setInterval(() => setUndoSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250)
    return () => clearInterval(timer)
  }, [deleted])
  useEffect(() => { try { localStorage.setItem('lt-current', JSON.stringify(segments)) } catch { setMessage('儲存空間已滿或無法使用，請下載逐字稿以保留內容。Storage is full or unavailable. Download your transcript to keep it.') } }, [segments])
  useEffect(() => { try { localStorage.setItem('lt-history', JSON.stringify(history)) } catch { setMessage('無法儲存歷史紀錄，請下載逐字稿。Could not save history. Download your transcript instead.') } }, [history])
  useEffect(() => { setTranslationErrors(ids => { const remaining = unresolvedTranslations(ids, segments, history); return remaining.length === ids.length ? ids : remaining }) }, [segments, history])
  function run(segment: Segment) { queue.current?.enqueue(segment.id) }
  async function execute(segment: Segment) {
    if (active.current.has(segment.id) || !translationReady(segment)) return
    const controller = new AbortController(); active.current.set(segment.id, controller)
    const update = (patch: Partial<Segment>) => {
      const apply = (items: Segment[]) => items.map(s => s.id === segment.id && s.en === segment.en && translationReady(s) ? { ...s, ...patch } : s)
      changeSegments(apply)
      changeHistory(items => items.map(session => ({ ...session, segments: apply(session.segments) })))
    }
    const context = previousContext(segment.id, segmentsRef.current, historyRef.current)
    update({ status: 'translating' })
    try { const zh = await translate(segment.en, controller.signal, zh => update({ zh }), context, { spoken: segment.spoken }); controller.signal.throwIfAborted(); update({ zh, status: 'done', translation: { source: segment.en, text: zh } }); setAnnouncement(`${segment.en}. ${zh}`); if (autoRef.current && segmentsRef.current.some(s => s.id === segment.id)) speakRef.current(zh) }
    catch (error) { if (!controller.signal.aborted) { const pending = !navigator.onLine; const retryable = !(error && typeof error === 'object' && 'retryable' in error && error.retryable === false); update({ status: pending ? 'pending' : 'error', retryable }); setAnnouncement(pending ? '英文已保留，連線後自動翻譯。English saved; translation resumes online.' : retryable ? '翻譯延遲，英文已保留，將自動重試。Translation delayed; English saved; retrying automatically.' : '翻譯未完成，請重試。Translation needs attention; please retry.'); if (!pending) setTranslationErrors(ids => ids.includes(segment.id) ? ids : [...ids, segment.id]) } throw error }
    finally { active.current.delete(segment.id); const latest = [...segmentsRef.current, ...historyRef.current.flatMap(s => s.segments)].find(s => s.id === segment.id); if (latest && latest.en !== segment.en) void run(latest) }
  }
  function commit(text: string, metadata: SpeechMetadata = {}) {
    const en = text.trim(); if (!en) return
    setSelectedId(null); setHistoryOpen(false)
    let firstId
    for (const part of splitText(en)) {
      const segment: Segment = { id: uid(), en: part, zh: '', timestamp: Date.now(), status: 'pending', ...metadata }
      firstId ??= segment.id
      changeSegments(items => [...items, segment]); void run(segment)
    }
    setInterim('')
    return firstId
  }
  function reviseSpeech(id: string, en: string, metadata: SpeechMetadata) {
    const previous = [...segmentsRef.current, ...historyRef.current.flatMap(s => s.segments)].find(s => s.id === id)
    if (previous?.en !== en || !translationReady(metadata)) active.current.get(id)?.abort()
    const apply = (items: Segment[]) => items.flatMap(s => s.id !== id ? [s] : !en ? [] : [reviseRecognizedSegment(s, en, metadata) as Segment])
    changeSegments(apply); changeHistory(items => items.map(s => ({ ...s, segments: apply(s.segments) })))
    const segment = [...segmentsRef.current, ...historyRef.current.flatMap(s => s.segments)].find(s => s.id === id)
    if (segment?.status === 'pending') void run(segment)
  }
  const commitRef = useRef(commit); commitRef.current = commit
  const reviseRef = useRef(reviseSpeech); reviseRef.current = reviseSpeech
  useEffect(() => {
    const resume = () => { for (const s of retryableSegments(segmentsRef.current, historyRef.current)) void run(s) }
    const reconnect = () => { setOnline(true); resume(); queue.current?.wake() }
    const storageChanged = () => queue.current?.wake()
    const disconnect = () => setOnline(false)
    window.addEventListener('online', reconnect); window.addEventListener('offline', disconnect)
    window.addEventListener('storage', storageChanged)
    resume()
    return () => { window.removeEventListener('online', reconnect); window.removeEventListener('offline', disconnect); window.removeEventListener('storage', storageChanged); queue.current?.dispose(); for (const controller of active.current.values()) controller.abort() }
  }, [])
  useEffect(() => {
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Constructor) return
    const controller = createSpeechController(new Constructor(), { commit: (text: string, metadata: SpeechMetadata) => commitRef.current(text, { ...metadata, spoken: true }), revise: (id: string, text: string, metadata: SpeechMetadata) => reviseRef.current(id, text, metadata), preview: setInterim, state: setMicState, message: setMicMessage })
    speech.current = controller
    return () => controller.dispose()
  }, [])
  function toggleMic() {
    if (micState !== 'idle') speech.current?.stop()
    else { setSelectedId(null); setHistoryOpen(false); void device().then(t => setLocalReady(!!t)); speech.current?.start() }
  }
  async function newSession() {
    await speech.current?.finish()
    follower.current = createTranscriptFollower()
    const saved = segmentsRef.current
    if (saved.length) changeHistory(items => [{ id: uid(), timestamp: Date.now(), segments: saved }, ...items])
    changeSegments(() => []); setInput(''); setInterim(''); setSelectedId(null); setHistoryOpen(false); setMessage('')
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
  useLayoutEffect(() => {
    if (view.current !== selectedId) { view.current = selectedId; follower.current = createTranscriptFollower() }
    const element = transcriptElement.current
    if (!element) return
    const update = () => setFollowState(follower.current.update(element, shown.map(s => s.id)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (transcriptContent.current) observer.observe(transcriptContent.current)
    return () => observer.disconnect()
  }, [shown, interim, selectedId, font])
  async function exportedTranscript() {
    setExporting(true)
    const id = selectedId
    try {
      const items = await waitForTranslations(() => id ? historyRef.current.find(session => session.id === id)?.segments || [] : segmentsRef.current)
      if (items.some(segment => segment.status !== 'done')) setMessage('部分譯文尚未完成，匯出已清楚標示，英文與警示均已保留。Some translations are still pending and marked in the export; English and warnings are preserved.')
      return formatTranscript(items, warnings)
    } finally { setExporting(false) }
  }
  async function copyTranscript() { try { await navigator.clipboard.writeText(await exportedTranscript()); setMessage('已複製逐字稿；尚未完成的譯文會明確標示。Transcript copied; any pending translations are explicitly marked.') } catch { setMessage('無法複製，請改用下載。Copy unavailable. Use Download instead.') } }
  async function download() { const transcript = await exportedTranscript(); const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'live-translator-transcript.txt'; a.click(); URL.revokeObjectURL(url) }
  const transcript = transcriptElement.current
  const jump = jumpLabel(followState.following, followState.unread, !!selected, transcript ? transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop : 0)
  return languageText(<div className={`app ${largeUI ? 'large-ui' : ''}`} lang="zh-Hant-TW">
    <header><a className="brand" href="/" aria-label="即時翻譯首頁 / Live Translator home"><span className="logo">譯</span><span>Live Translator<small>即時翻譯 · 理解彼此</small></span></a><span className={`connection ${online ? '' : 'offline'}`}><i />{online ? '連線 Online' : '離線 Offline'}</span></header>
    <main>
      <div className="heading"><div><div className="eyebrow">一句一句，拉近距離 · ONE WORD AT A TIME</div><h1>對話，不再有隔閡<span>。</span></h1><p>說英文，即時看繁體中文。<br/>Speak English. Connect in Traditional Chinese.</p></div><span className="decor" aria-hidden="true">你好<span>hello</span></span></div>
      <div className="workspace" ref={workspaceElement}>
        <div className="toolbar"><div className="languages"><span><b>EN</b> 英文 English</span><span className="arrow">→</span><span><b>繁</b> 繁體中文 <small>TW Chinese</small></span></div><button className="quiet" aria-expanded={historyOpen} aria-controls="history" onClick={() => setHistoryOpen(!historyOpen)}>◷ <span>歷史 History</span>{history.length > 0 && <em>{history.length}</em>}</button></div>
        <div className="sessionbar"><span><i className={mic ? 'live-dot' : ''} />{selected ? '已存對話 / SAVED' : micState === 'requesting' ? '等待麥克風 / REQUESTING MIC' : mic ? '收音中 / LISTENING' : '目前對話 / CURRENT'} <small> / {shown.length} 段 segments</small></span><div className="fontcontrol"><label htmlFor="font">字級 Size</label><input aria-label="字幕字級 / Subtitle font size" id="font" type="range" min="20" max="42" value={font} onChange={e => setFont(Number(e.target.value))} /><span>Aa</span></div></div>
        {historyOpen && <section className="history" id="history"><h2>您的對話 / Your conversations</h2>{history.length === 0 ? <p>尚未儲存對話，請按下方「儲存／新對話」。No saved sessions yet. Save a conversation below.</p> : history.map(session => <div className="history-row" key={session.id}><button onClick={() => { setSelectedId(session.id); if (matchMedia('(max-width: 640px) and (min-height: 501px)').matches) setHistoryOpen(false) }}>{new Date(session.timestamp).toLocaleString()}<small>{session.segments.length} 段 segments · {session.segments[0]?.en.slice(0, 44)}</small></button><button aria-label={`刪除對話 / Delete session: ${new Date(session.timestamp).toLocaleString()}`} onClick={() => deleteSession(session)}>刪除 Delete</button></div>)}{selected && <button onClick={() => { setSelectedId(null); setHistoryOpen(false) }}>← 返回目前對話 / Back to live session</button>}</section>}
        <section ref={transcriptElement} onScroll={e => setFollowState(follower.current.scroll(e.currentTarget))} className="subtitles" aria-label="雙語字幕 / Bilingual subtitles" tabIndex={0} style={{ '--subtitle-size': `${font}px` } as React.CSSProperties}>
          <div ref={transcriptContent}>
          {!shown.length && !interim && <div className="empty"><div className="wave" aria-hidden="true">{[14, 26, 40, 22, 50, 32, 18, 36, 24].map((h, i) => <i key={i} style={{ height: h }} />)}</div><h2>{micState === 'requesting' ? '等待麥克風授權 / Requesting microphone…' : mic ? '已開始收音，請說話。You’re on. Say hello.' : '從一句話，開始理解。Start a conversation.'}</h2><p>{micState === 'requesting' ? '請在瀏覽器提示中選擇「允許」。Allow microphone access in your browser.' : mic ? '英文與中文翻譯將顯示在這裡。Your words and translation appear here.' : '按麥克風並允許權限，或在下方輸入英文。\nTap the microphone and allow access, or type English below.'}</p><span className="empty-tag">英文 ENGLISH <span>→</span> 繁體中文</span></div>}
          {shown.map((s, index) => { const state = captionState(s, online, providerState); return <article className="segment" key={s.id}><div className="segment-meta"><span>{String(index + 1).padStart(2, '0')}</span><time>{new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>{state.label}</span></div>
            <div className="quality">{!s.provisional && !s.forced && s.confidence !== undefined && <span>辨識信心 / Confidence: {Math.round(s.confidence * 100)}%</span>}{s.forced && <span>暫存語音，尚未收到最終辨識 / Saved speech; final recognition unavailable</span>}{warnings(s, shown.slice(Math.max(0, index - 2), index)).length > 0 && <span className="check">⚠ 請核對 Check: {warnings(s, shown.slice(Math.max(0, index - 2), index)).join('；')}</span>}</div>
            <p className="english" lang="en">{s.en}</p>{translationReady(s) && <><span className="translation-replay"><button className="chinese" lang="zh-TW" aria-label={`朗讀譯文 / Read translation: ${s.zh}`} aria-describedby={`replay-${s.id}`} onClick={() => speak(s.zh)} disabled={!s.zh}>{s.zh || state.placeholder}<span> ↗</span></button><span className="translation-tooltip" id={`replay-${s.id}`} role="tooltip" lang="zh-Hant-TW">朗讀譯文 / Replay translation</span></span>{state.manualRetry && <button className="retry" onClick={() => void run(s)}>↻ 重新翻譯 / Retry translation</button>}</>}</article>})}
          {interim && !selected && <article className="segment preview"><div className="segment-meta">即時預覽 / LIVE PREVIEW</div><p className="english" lang="en">{interim}</p></article>}
          </div>
        </section>
        <div className="transcript-actions">{jump && <button className="jump-latest" onClick={() => { if (transcriptElement.current) follower.current.jump(transcriptElement.current); setFollowState({ following: true, unread: 0 }) }}>{jump}</button>}<span>{exporting ? '等待譯文（最多 2 秒）/ Waiting for translations (up to 2s)' : '↗ 點譯文即可朗讀 / Tap translation to listen'}</span><div>{shown.length > 0 && <><button disabled={exporting} onClick={() => void copyTranscript()}>複製 Copy</button><button disabled={exporting} onClick={() => void download()}>下載 Download .txt</button></>}<button onClick={() => void newSession()} disabled={!segments.length && !interim && !input}>儲存／新增 Save/New</button></div></div>
      </div>
      {!speechSupported && <p className="notice">此瀏覽器不支援語音辨識，請輸入英文，或改用 Chrome、Edge、Safari。Speech recognition isn’t available. Type English below or use Chrome, Edge or Safari.</p>}
      <div className="notifications">{micMessage && <div className="notice" role="alert"><span>{micMessage}</span><button onClick={() => { setSelectedId(null); setHistoryOpen(false); speech.current?.start() }}>重試麥克風 / Retry mic</button></div>}{providerState.pending > 0 && (providerState.reason || providerState.pending > 2) ? <div className="notice provider-delay" role="status"><span>翻譯延遲{providerState.reason ? '，翻譯服務暫時限流或無法使用' : ''}；英文已保留，依序自動重試。目前 {providerState.pending} 段等待。Translation delayed{providerState.reason ? ' / provider throttled or unavailable' : ''}; English saved, oldest first. {providerState.pending} waiting.</span></div> : translationErrors.length > 0 && <div className="notice" role="status"><span>翻譯尚未完成，英文已保留；請查看各段狀態。Translation pending; English saved. See each caption’s status.</span><button onClick={() => setTranslationErrors([])} aria-label="關閉訊息 / Dismiss message">×</button></div>}{message && <div className="notice" role="status"><span>{message}</span><button onClick={() => setMessage('')} aria-label="關閉訊息 / Dismiss message">×</button></div>}
      {deleted && <div className="notice" role="status"><span>已刪除對話 / Session deleted. {undoSeconds > 0 ? `至少保留 ${undoSeconds} 秒，之後仍可復原 / At least ${undoSeconds}s remaining; Undo stays available` : '復原保留至關閉 / Undo available until dismissed'}</span><button onClick={undoDelete}>復原 Undo</button><button onClick={() => setDeleted(null)} aria-label="關閉復原訊息 / Dismiss Undo">×</button></div>}</div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div><div className="sr-only" role="status">{micState === 'retrying' ? '麥克風重新連線中 / Reconnecting microphone' : micState === 'requesting' ? '等待麥克風授權 / Requesting microphone' : mic ? '收音中 / Listening' : '麥克風已關閉 / Microphone off'}. {online ? '連線 / Online' : '離線 / Offline'}</div>
      <div className="bottom-bar" ref={bottomBarElement}><form className="inputbox" onSubmit={e => { e.preventDefault(); commit(input); setInput(''); setSelectedId(null); setHistoryOpen(false); void device().then(t => setLocalReady(!!t)) }}><label className="sr-only" htmlFor="english">輸入英文翻譯，長文將自動分段。Type English; long text is split into segments.</label><textarea ref={composer} id="english" rows={2} value={input} onChange={e => setInput(e.target.value)} placeholder="在此輸入英文 / Type English here…" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} /><button type="submit" disabled={!input.trim()} aria-label="翻譯輸入文字 / Translate message">↑</button></form>
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
  </div>)
}
createRoot(document.getElementById('root')!).render(<App />)
if (import.meta.env.PROD && import.meta.env.VITE_DISABLE_SW !== '1') startServiceWorker()
