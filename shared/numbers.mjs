const digits = Object.fromEntries([... '零〇一二三四五六七八九'].map((char, i) => [char, i < 2 ? 0 : i - 1]))
Object.assign(digits, { 兩: 2, 两: 2 })
const smallUnits = { 十: 10, 百: 100, 千: 1000 }
const scales = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }
const cardinal = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const ordinal = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth']
const english = Object.fromEntries([...cardinal.map((word, n) => [word, n]), ...ordinal.map((word, n) => [word, n])])
for (const [i, word] of ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'].entries()) english[word] = (i + 2) * 10
Object.assign(english, { twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90 })
const numberWord = Object.keys(english).join('|')
const phrase = new RegExp(`\\b(?:${numberWord})(?:[ -]+(?:${numberWord}|hundred|thousand|million|billion|trillion|and|point))*\\b`, 'gi')

function englishValue(tokens) {
  let total = 0; let section = 0
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i]
    if (word === 'point') {
      let decimal = ''
      while (i + 1 < tokens.length && english[tokens[i + 1]] < 10) decimal += english[tokens[++i]]
      section += Number(`0.${decimal || '0'}`)
    } else if (word === 'hundred') section = (section || 1) * 100
    else if (scales[word]) { total += (section || 1) * scales[word]; section = 0 }
    else if (english[word] !== undefined) section += english[word]
  }
  return total + section
}
function chineseValue(text) {
  for (const [unit, scale] of [['兆', 1e12], ['億', 1e8], ['萬', 1e4]]) {
    const index = text.indexOf(unit)
    if (index >= 0) return (index ? chineseValue(text.slice(0, index)) : 1) * scale + (index + 1 < text.length ? chineseValue(text.slice(index + 1)) : 0)
  }
  const fraction = text.match(/^(.+?)[點.]([\d零〇一二三四五六七八九兩两]+)([十百千]?)$/)
  if (fraction) return (chineseValue(fraction[1]) + Number(`0.${[...fraction[2]].map(c => digits[c] ?? c).join('')}`)) * (smallUnits[fraction[3]] || 1)
  const decimal = value => Number([...value].map(c => digits[c] ?? (c === '點' ? '.' : c)).join(''))
  let total = 0; let pending = ''
  for (const char of text) {
    if (smallUnits[char]) { total += (pending ? decimal(pending) : 1) * smallUnits[char]; pending = '' }
    else pending += char
  }
  return total + (pending ? decimal(pending) : 0)
}
export function numericValues(input) {
  let text = input.normalize('NFKC').replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '').replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1')
  text = text.replace(/([\d零〇一二三四五六七八九兩两十]+)[點点時时]([\d零〇一二三四五六七八九兩两十]+)分/g, '$1 $2')
  text = text.replace(/([\d零〇一二三四五六七八九兩两十百千])\s+(?=[十百千萬億兆])/g, '$1')
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  text = text.replace(new RegExp(`\\b(${months.join('|')})\\b(?=\\s+(?:\\d|${numberWord}))`, 'gi'), month => String(months.indexOf(month.toLowerCase()) + 1))
  text = text.replace(/\ba\s+(?=hundred|thousand|million|billion|trillion)/gi, 'one ')
  text = text.replace(phrase, value => {
    const tokens = value.toLowerCase().split(/[ -]+/)
    if (!tokens.some(word => word === 'hundred' || scales[word])) return tokens.join(' ').split(/\s+and\s+/).map(part => englishValue(part.split(' '))).join(' ')
    return String(englishValue(tokens))
  }).replace(/\bminus\s+(?=\d)/gi, '-').replace(/百分之/g, '').replace(/万/g, '萬').replace(/亿/g, '億').replace(/点/g, '點')
  const pattern = /([-+負负]?)([\d零〇一二三四五六七八九兩两十百千萬億兆]+(?:[.點][\d零〇一二三四五六七八九兩两]+)?[\d零〇一二三四五六七八九兩两十百千萬億兆]*)(?:\s*(thousand|million|billion|trillion|k|m|b|t)\b)?/gi
  return [...text.matchAll(pattern)].map(match => Number((chineseValue(match[2]) * (scales[match[3]?.toLowerCase()] || 1) * (/[-負负]/.test(match[1]) ? -1 : 1)).toPrecision(12)))
}

export function numericPrefix(text) {
  return text.match(new RegExp(`^(?:US\\s*)?[$€£]?\\s*(?:\\d[\\d,]*(?:\\.\\d+)?(?:\\s*(?:thousand|million|billion|trillion|[kmbt]\\b))?|${phrase.source})(?:%|\\s+(?:percent|basis points))?(?:\\s+(?:US\\s+)?dollars?)?`, 'i'))?.[0] || ''
}

export function normalizeSpokenNumbers(text) {
  return text.replace(phrase, value => {
    const amount = value.replace(/[ -]+and$/i, '')
    if (!/\b(?:thousand|million|billion|trillion)$/i.test(amount)) return value
    if ((amount.match(/\b(?:thousand|million|billion|trillion)\b/gi) || []).length !== 1) return value
    const values = numericValues(amount)
    return values.length === 1 ? String(values[0]) + value.slice(amount.length) : value
  })
}

export function currencyFigures(text) {
  return text.replace(/[\d零〇一二三四五六七八九兩两十百千]+[點.][\d零〇一二三四五六七八九兩两]+(?:百萬|千萬|百億|千億)(?=\s*(?:美元|加元|澳元|港元|日圓|歐元|英鎊|元))/g, amount => {
    const value = numericValues(amount)[0]
    const [unit, scale] = value >= 1e8 ? ['億', 1e8] : ['萬', 1e4]
    return `${Number((value / scale).toPrecision(12))}${unit}`
  })
}
