const seating = [/\b(?:sit|sits|sitting|seated|seating|seats?)\b/i, /坐|座位|就座|落座/]
export function seatingSource(text) {
  return text.replace(/\b(places?) to sit(?: down)?(?=\s+(?:near|at|in|on|by)\b|\s*[.!?,;:]|$)/gi, (_all, place) => /^places$/i.test(place) ? 'seats' : 'seat')
}

const concepts = [
  [/\blibrar(?:y|ies)\b/i, /圖書館|图书馆/],
  [/\bpark\b/i, /公園|公园/],
  [/\b(?:safest|safe|safety|secure)\b/i, /安全/],
  [/\b(?:map|maps)\b/i, /地圖|地图/],
  [/\b(?:walking route|footpath)\b/i, /步行|走路|人行|步道/],
  [/\b(?:hurry|rushing)\b/i, /趕|赶|急|匆忙/],
  [/\bstreet\b/i, /街|道路|路上/],
  seating,
  [/\b(?:wait(?:s|ed|ing)?|await(?:s|ed|ing)?)\b/i, /等(?:待|候|著|着|我們|我|你|他|她|[，。；！？\s]|$)|稍候|候診|候車|候機/]
]

export function seatingMismatch(source, translated) {
  return seating[0].test(source) && !seating[1].test(translated)
}

export function semanticMismatch(source, translated) {
  if (concepts.some(([english, chinese]) => english.test(source) && !chinese.test(translated))) return true
  if (/最安全/.test(translated) && !/\b(?:safe|safest|safety|secure)\b/i.test(source)) return true
  if (/步行路線|步行路线/.test(translated) && !/\b(?:walk|walking|route|directions|footpath)\b/i.test(source)) return true
  return false
}
