import { translationReady } from './transcript.mjs'

export function captionState(segment, online, provider = { pending: 0, retryAt: 0, reason: '' }) {
  const state = (label, placeholder = label, manualRetry = false) => ({ label, placeholder, manualRetry })
  if (!translationReady(segment)) return state('等待最終辨識 / Awaiting final recognition')
  if (segment.status === 'done') return state('✓ 翻譯完成 / Translated')
  if (!online) return state('英文已保留，連線後自動翻譯 / Saved; translation resumes online', '等待連線…')
  if (segment.status === 'translating') return state('翻譯中 / Translating…', '翻譯中…')
  if (segment.status === 'error' && segment.retryable === false) return state('翻譯未完成，請重試 / Translation needs attention', '請重試翻譯', true)
  if (provider.pending && provider.reason) return state('翻譯服務忙碌，將自動重試 / Translation service busy, retrying automatically', '翻譯服務忙碌，將自動重試…')
  if (segment.status === 'error') return state('翻譯延遲，將自動重試 / Translation delayed, retrying automatically', '翻譯延遲，將自動重試…')
  return state('等待翻譯 / Queued for translation', '等待翻譯…')
}
