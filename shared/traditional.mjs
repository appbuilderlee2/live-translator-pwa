import { Converter } from './vendor/opencc-cn2t.mjs'

const convert = Converter({ from: 'cn', to: 'twp' })
export function traditional(text) {
  let result = convert(text).replace(/\bTaipei Main Station\b/gi, '台北車站').replace(/\bTaipei Metro\b/gi, '台北捷運')
    .replace(/健康保險卡/g, '健保卡').replace(/有個醫生預約/g, '有預約看診').replace(/當你到達時[，,]?\s*請打電話給我/g, '到了請打電話給我')
  if (/服用/.test(result)) result = result.replace(/([一二兩三四五六七八九十\d]+)[粒片](?=[，。；、\s]|$)/g, '$1顆')
  return result
}

export function translationBuffer(emit) {
  let pending = ''
  return {
    push(text) {
      pending += text
      const boundary = Math.max(...['。', '！', '？', '\n', '，', ',', ';', '；', '!', '?'].map(char => pending.lastIndexOf(char)))
      if (boundary >= 0) { emit(traditional(pending.slice(0, boundary + 1))); pending = pending.slice(boundary + 1) }
    },
    finish() { if (pending) emit(traditional(pending)); pending = '' }
  }
}
