import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type Segment = { id: string; en: string; zh: string; timestamp: number; status: 'pending' | 'translating' | 'done' | 'error' }
type Session = { id: string; timestamp: number; segments: Segment[] }
type Recognition = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: ((event: { resultIndex: number; results: { length: number; [key: number]: { isFinal: boolean; [key: number]: { transcript: string } } } }) => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null }
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
async function translate(text: string, signal: AbortSignal, update: (text: string) => void) {
  const local = await device()
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (local) {
    try {
      const result = await Promise.race([local.translate(text), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('On-device translation timed out')), 5000))])
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      update(result); return result
    } catch { if (signal.aborted) throw new DOMException('Aborted', 'AbortError') }
  }
  if (!navigator.onLine) throw new Error('offline')
  const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal })
  if (!response.ok || !response.body) throw new Error('Translation unavailable. Tap retry to try again.')
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let result = ''
  while (true) { const { done, value } = await reader.read(); result += decoder.decode(value, { stream: !done }); if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); update(result); if (done) break }
  if (!result.trim()) throw new Error('No translation received. Please retry.')
  return result
}
function speak(text: string) {
  if (!text || !('speechSynthesis' in window)) return
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'zh-TW'
  const voices = speechSynthesis.getVoices(); utterance.voice = voices.find(v => v.lang.toLowerCase() === 'zh-tw') || voices.find(v => v.lang.startsWith('zh')) || null
  speechSynthesis.speak(utterance)
}
function App() {
  const [segments, setSegments] = useState<Segment[]>(() => load<Segment[]>('lt-current', []).map(s => ({ ...s, status: s.status === 'translating' ? 'pending' : s.status })))
  const [history, setHistory] = useState<Session[]>(() => load('lt-history', []))
  const [historyOpen, setHistoryOpen] = useState(false); const [selected, setSelected] = useState<Session | null>(null)
  const [online, setOnline] = useState(navigator.onLine); const [mic, setMic] = useState(false); const [input, setInput] = useState('')
  const [interim, setInterim] = useState(''); const [preview, setPreview] = useState(''); const [message, setMessage] = useState('')
  const [autoSpeak, setAutoSpeak] = useState(false); const [font, setFont] = useState(28); const [localReady, setLocalReady] = useState(false)
  const micRef = useRef(false); const recognition = useRef<Recognition | null>(null); const autoRef = useRef(false)
  const active = useRef(new Map<string, AbortController>()); const epoch = useRef(0); const bottom = useRef<HTMLDivElement>(null); const segmentsRef = useRef(segments)
  segmentsRef.current = segments; autoRef.current = autoSpeak
  useEffect(() => { try { localStorage.setItem('lt-current', JSON.stringify(segments)) } catch { setMessage('Storage is full or unavailable. Download your transcript to keep it.') } }, [segments])
  useEffect(() => { try { localStorage.setItem('lt-history', JSON.stringify(history)) } catch { setMessage('Could not save history. Download your transcript instead.') } }, [history])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [segments, preview])
  async function run(segment: Segment) {
    if (active.current.has(segment.id)) return
    const controller = new AbortController(); active.current.set(segment.id, controller); const version = epoch.current
    const update = (patch: Partial<Segment>) => { if (version === epoch.current && !controller.signal.aborted) setSegments(items => items.map(s => s.id === segment.id ? { ...s, ...patch } : s)) }
    update({ status: 'translating', zh: '' })
    try { const zh = await translate(segment.en, controller.signal, zh => update({ zh })); update({ zh, status: 'done' }); if (autoRef.current && !controller.signal.aborted && version === epoch.current) speak(zh) }
    catch (error) { if (!controller.signal.aborted) { const pending = !navigator.onLine; update({ status: pending ? 'pending' : 'error' }); if (!pending) setMessage(error instanceof Error ? error.message : 'Translation failed.') } }
    finally { active.current.delete(segment.id) }
  }
  function commit(text: string) {
    const en = text.trim(); if (!en) return
    if (en.length > 2000) { setMessage('Please use up to 2,000 characters per segment.'); return }
    const segment: Segment = { id: uid(), en, zh: '', timestamp: Date.now(), status: 'pending' }
    setSegments(items => [...items, segment]); setInterim(''); setPreview(''); void run(segment)
  }
  const commitRef = useRef(commit); commitRef.current = commit
  useEffect(() => {
    const reconnect = () => { setOnline(true); for (const s of segmentsRef.current) if (s.status === 'pending') void run(s) }
    const disconnect = () => setOnline(false)
    window.addEventListener('online', reconnect); window.addEventListener('offline', disconnect)
    for (const s of segmentsRef.current) if (s.status === 'pending') void run(s)
    return () => { window.removeEventListener('online', reconnect); window.removeEventListener('offline', disconnect) }
  }, [])
  useEffect(() => {
    setPreview(''); if (!interim.trim()) return
    const controller = new AbortController()
    const timer = setTimeout(() => { void translate(interim.slice(0, 2000), controller.signal, setPreview).catch(() => {}) }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [interim])
  useEffect(() => {
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Constructor) return
    const rec = new Constructor(); recognition.current = rec; rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'
    let restart: ReturnType<typeof setTimeout>
    rec.onresult = event => { let draft = ''; for (let i = event.resultIndex; i < event.results.length; i++) { const result = event.results[i]; if (result.isFinal) commitRef.current(result[0].transcript); else draft += result[0].transcript } setInterim(draft) }
    rec.onerror = event => { if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') { micRef.current = false; setMic(false); setMessage('Microphone unavailable. Allow microphone access in your browser, or type below.') } else if (event.error === 'no-speech') setMessage('No speech detected. Try speaking closer to your microphone.'); else if (event.error !== 'aborted') setMessage(`Speech recognition: ${event.error}. You can still type below.`) }
    rec.onend = () => { if (micRef.current) restart = setTimeout(() => { try { rec.start() } catch { micRef.current = false; setMic(false); setMessage('Could not restart microphone. Tap to try again.') } }, 300) }
    return () => { micRef.current = false; clearTimeout(restart); rec.onend = null; rec.stop() }
  }, [])
  function toggleMic() {
    if (micRef.current) { micRef.current = false; setMic(false); recognition.current?.stop(); setInterim('') }
    else { setMessage(''); void device().then(t => setLocalReady(!!t)); try { recognition.current?.start(); micRef.current = true; setMic(true) } catch { setMessage('Microphone could not start. Please try again.') } }
  }
  function newSession() {
    micRef.current = false; setMic(false); recognition.current?.stop(); epoch.current++; for (const controller of active.current.values()) controller.abort(); active.current.clear()
    if (segments.length) setHistory(items => [{ id: uid(), timestamp: Date.now(), segments: segments.map(s => ({ ...s, status: s.status === 'translating' ? 'pending' : s.status })) }, ...items])
    setSegments([]); setInterim(''); setPreview(''); setSelected(null); setHistoryOpen(false); setMessage('')
  }
  const shown = selected?.segments || segments
  const transcript = shown.map(s => `${new Date(s.timestamp).toLocaleString()}\n${s.en}\n${s.zh || '[Pending translation]'}`).join('\n\n')
  function download() { const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'live-translator-transcript.txt'; a.click(); URL.revokeObjectURL(url) }
  return <div className="app">
    <header><a className="brand" href="/" aria-label="Live Translator home"><span className="logo">譯</span><span>Live Translator<small>LESS LOST IN TRANSLATION</small></span></a><span className={`connection ${online ? '' : 'offline'}`}><i />{online ? 'Online' : 'Offline'}</span></header>
    <main>
      <div className="heading"><div><div className="eyebrow">A LITTLE CLOSER, ONE WORD AT A TIME</div><h1>Conversations,<br className="mobile-break" /> without borders<span>.</span></h1><p>Speak English. Connect in Traditional Chinese.</p></div><span className="decor" aria-hidden="true">你好<span>hello</span></span></div>
      <div className="workspace">
        <div className="toolbar"><div className="languages"><span><b>EN</b> English</span><span className="arrow">→</span><span><b>繁</b> 繁體中文 <small>TW</small></span></div><button className="quiet" onClick={() => { setHistoryOpen(!historyOpen); setSelected(null) }}>◷ <span>History</span>{history.length > 0 && <em>{history.length}</em>}</button></div>
        <div className="sessionbar"><span><i className={mic ? 'live-dot' : ''} />{selected ? 'SAVED SESSION' : mic ? 'LISTENING LIVE' : 'CURRENT SESSION'} <small> / {shown.length} segments</small></span><div className="fontcontrol"><label htmlFor="font">Aa</label><input aria-label="Subtitle font size" id="font" type="range" min="20" max="42" value={font} onChange={e => setFont(Number(e.target.value))} /><span>Aa</span></div></div>
        {historyOpen && <section className="history"><h2>Your conversations</h2>{history.length === 0 ? <p>No saved sessions yet. Save your first conversation below.</p> : history.map(session => <div className="history-row" key={session.id}><button onClick={() => setSelected(session)}>{new Date(session.timestamp).toLocaleString()}<small>{session.segments.length} segments · {session.segments[0]?.en.slice(0, 44)}</small></button><button aria-label="Delete session" onClick={() => { setHistory(items => items.filter(s => s.id !== session.id)); if (selected?.id === session.id) setSelected(null) }}>Delete</button></div>)}{selected && <button onClick={() => { setSelected(null); setHistoryOpen(false) }}>← Back to live session</button>}</section>}
        <section className="subtitles" aria-label="Bilingual subtitles" style={{ '--subtitle-size': `${font}px` } as React.CSSProperties}>
          {!shown.length && !interim && <div className="empty"><div className="wave" aria-hidden="true">{[14, 26, 40, 22, 50, 32, 18, 36, 24].map((h, i) => <i key={i} style={{ height: h }} />)}</div><h2>{mic ? 'You’re on. Say hello.' : 'Good conversations start here.'}</h2><p>{mic ? 'Your words and their translation will appear here.' : 'Tap the microphone or type a message below.\nWe’ll take care of the translation.'}</p><span className="empty-tag">ENGLISH <span>→</span> 繁體中文</span></div>}
          {shown.map((s, index) => <article className="segment" key={s.id}><div className="segment-meta"><span>{String(index + 1).padStart(2, '0')}</span><time>{new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>{s.status === 'pending' ? 'Saved · waiting for connection' : s.status === 'translating' ? 'Translating…' : s.status === 'error' ? 'Translation interrupted' : '✓ Translated'}</span></div><p className="english">{s.en}</p><button className="chinese" lang="zh-TW" title="Replay translation" onClick={() => speak(s.zh)} disabled={!s.zh}>{s.zh || (s.status === 'pending' ? '等待連線…' : s.status === 'error' ? '翻譯暫時無法使用' : '翻譯中…')}<span> ↗</span></button>{!selected && (s.status === 'pending' || s.status === 'error') && <button className="retry" onClick={() => void run(s)}>↻ Retry translation</button>}</article>)}
          {interim && !selected && <article className="segment preview"><div className="segment-meta">LIVE PREVIEW</div><p className="english">{interim}</p><p className="chinese" lang="zh-TW">{preview || '…'}</p></article>}<div ref={bottom} />
        </section>
        <div className="transcript-actions"><span>↗ Tap a translation to listen</span><div>{shown.length > 0 && <><button onClick={() => void navigator.clipboard.writeText(transcript).then(() => setMessage('Transcript copied.')).catch(() => setMessage('Copy unavailable. Use Download instead.'))}>Copy</button><button onClick={download}>Download .txt</button></>}<button onClick={newSession} disabled={!segments.length}>Save / New session ↗</button></div></div>
      </div>
      {!speechSupported && <p className="notice">Speech recognition isn’t available in this browser. Type English below, or use Chrome, Edge or Safari.</p>}
      {message && <div className="notice" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss message">×</button></div>}
      <form className="inputbox" onSubmit={e => { e.preventDefault(); commit(input); setInput(''); setSelected(null); setHistoryOpen(false); void device().then(t => setLocalReady(!!t)) }}><label className="sr-only" htmlFor="english">Type English to translate</label><textarea id="english" rows={1} maxLength={2000} value={input} onChange={e => setInput(e.target.value)} placeholder="Prefer to type? Write something in English…" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} /><button type="submit" disabled={!input.trim()} aria-label="Translate message">↑</button></form>
      <div className="controls"><label className="speak-toggle"><input type="checkbox" checked={autoSpeak} onChange={e => setAutoSpeak(e.target.checked)} /><span className="switch"/><span>Speak translations<small>TRADITIONAL CHINESE</small></span></label><div className="mic-group"><button className={`mic ${mic ? 'recording' : ''}`} disabled={!speechSupported} onClick={toggleMic} aria-label={mic ? 'Stop listening' : 'Start microphone'}>{mic ? <span className="stop-icon"/> : <svg width="24" height="28" viewBox="0 0 24 28" fill="none" aria-hidden="true"><rect x="8" y="2" width="8" height="15" rx="4" stroke="currentColor" strokeWidth="2"/><path d="M4 12v2a8 8 0 0016 0v-2M12 22v4M8 26h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>}</button><span>{mic ? 'Tap to stop listening' : 'Tap to start speaking'}</span></div><div className="privacy"><span>◈ {localReady ? 'On-device translation' : 'Your words, in the moment'}</span><small>{localReady ? 'READY TO WORK OFFLINE' : 'NO ACCOUNT NEEDED'}</small></div></div>
    </main><footer><span>Made for a world that understands.</span><a href="https://app.devin.ai/sessions/aa4435ec5490439f866a5c005af82a75" target="_blank" rel="noreferrer">Request changes ↗</a></footer>
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
