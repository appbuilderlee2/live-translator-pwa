export async function speakTranslation(text, synthesis, Utterance, notify, { choice = 'zh-TW', rate = 1 } = {}) {
  if (!text) return
  if (!synthesis) { notify('此瀏覽器不支援朗讀。Speech playback is not supported in this browser.'); return }
  let voices = synthesis.getVoices()
  if (!voices.some(v => /^zh(?:-|_)/i.test(v.lang))) {
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); synthesis.removeEventListener('voiceschanged', done); resolve() }
      const timer = setTimeout(done, 900)
      synthesis.addEventListener('voiceschanged', done)
    })
    voices = synthesis.getVoices()
  }
  const voice = voices.find(v => /^zh(?:-|_)/i.test(v.lang) && (v.voiceURI === choice || v.lang.toLowerCase() === choice.toLowerCase()))
  if (!voice) { notify(`未安裝所選的中文語音（${choice}）。請到裝置的「語言／語音」設定下載台灣華語或香港粵語語音，再重新整理並選擇語音。Selected Chinese voice is not installed (${choice}). Add a Chinese voice in device Language / Speech settings, reload, then choose an installed voice.`); return }
  synthesis.cancel()
  const utterance = new Utterance(text); utterance.lang = voice.lang; utterance.voice = voice; utterance.rate = rate
  utterance.onstart = () => notify('正在朗讀… Playing translation…')
  utterance.onend = () => notify('朗讀完畢。Playback finished.')
  utterance.onerror = event => { if (!['canceled', 'interrupted'].includes(event.error)) notify(`朗讀失敗（${event.error}），請檢查裝置的中文語音與音量設定。Speech playback failed (${event.error}). Check Chinese voice and audio settings.`) }
  synthesis.speak(utterance)
}
