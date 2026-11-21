import { Converter } from './vendor/opencc-cn2t.mjs'

const convert = Converter({ from: 'cn', to: 'twp' })
export function traditional(text) {
  let result = convert(text).replace(/\bTaipei Main Station\b/gi, '台北車站').replace(/\bTaipei Metro\b/gi, '台北捷運')
    .replace(/健康保險卡/g, '健保卡').replace(/有個醫生預約/g, '有預約看診').replace(/當你到達時[，,]?\s*請打電話給我/g, '到了請打電話給我')
    .replace(/公共汽車|(?<!觀光|旅遊|遊覽)巴士(?!海峽)/g, '公車')
    .replace(/社[群區](?:步行|徒步|健走)活動/g, '社區健走活動').replace(/印刷的說明|紙張上的說明/g, '紙本說明')
    .replace(/請{2,}/g, '請')
    .replace(/美元(?:\s*元)+(?=$|[\s，。,；;！？!?:：、])/g, '美元')
    .replace(/地鐵/g, '捷運')
    .replace(/家庭醫生/g, '家庭醫師').replace(/藥劑師/g, '藥師').replace(/(?:將其|把它)展示給((?:我|你)的)?家庭醫師/g, '拿給$1家庭醫師看')
  if (/臺北|台北|Taipei/i.test(result)) result = result.replace(/台北捷運站/g, '臺北捷運站').replace(/(?:Taipei|台北|臺北)\s*(?:subway|metro)(\s+station)?/gi, (_all, station) => `臺北捷運${station ? '站' : ''}`)
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
