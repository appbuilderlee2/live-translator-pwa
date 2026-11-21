const clauseStarts = /\b(?:please|thank you|we need|we are not|we would rather|do not|don't|I would like|my friend needs|we can|there are|revenue was|this year revenue|gross margin|net revenue retention)\b/i

export function speechClauses(text) {
  return text.split(new RegExp(`(?<=[.!?;])\\s+|(?<!\\b(?:hope|wish|think|believe|said|says|say|that|if|when|because|whether|know)\\s+)(?=${clauseStarts.source})`, 'i')).filter(chunk => chunk.trim())
}

export function readableChinese(source = '', text = '', complete = true) {
  const sentences = source.match(/[.!?](?:\s|$)/g)?.length || 0
  if (sentences < 2 && (source.match(/\b[a-z]+\b/gi)?.length || 0) < 25) return text
  let result = text
  const separate = pattern => {
    result = result.replace(pattern, (match, last, offset) => /(?:希望|認為|覺得|相信|告訴|說|是否|如果|只要|讓|叫|問|知道|以便|以為|想|但|但是|而且|因為|所以|然後|(?:告訴|問|讓|叫)[我你他她])$/.test(result.slice(0, offset + last.length)) ? match : `${last}。`)
  }
  if (/\bwe can\b/i.test(source)) separate(/([\p{Script=Han}\d])\s*(?=我們(?:可以|能夠))/gu)
  if (/\bwe need\b/i.test(source)) separate(/([\p{Script=Han}\d])\s*(?=我們需要)/gu)
  if (/(?<!\b(?:hope|wish|think|believe|said|says|say|that|if|when|because|whether|know)\s+)\bwe have\b/i.test(source)) separate(/([\p{Script=Han}\d])\s*(?=我們有)/gu)
  if (/\bI would like\b/i.test(source)) separate(/([\p{Script=Han}\d])\s*(?=我(?:想要|想|希望|要))/gu)
  if (/\bmy friend needs\b/i.test(source)) separate(/([\p{Script=Han}\d])\s*(?=我的朋友(?:需要|想要))/gu)
  if (/\bthere are\b/i.test(source)) separate(/([\p{Script=Han}])\s*(?=有[一二兩三四五六七八九十\d]+(?:個|位|名)?人(?:來|要來|會來))/gu)
  const meetingBoundaries = [
    [/\brevenue was\b/i, /([\p{Script=Han}\d%])\s*(?=(?:去年|上年|上一年)(?:的)?(?:營收|收入))/gu],
    [/\bthis year revenue\b/i, /([\p{Script=Han}\d%])\s*(?=今年(?:的)?(?:營收|收入))/gu],
    [/\bgross margin\b/i, /([\p{Script=Han}\d%])\s*(?=毛利率)/gu],
    [/\bnet revenue retention\b/i, /([\p{Script=Han}\d%])\s*(?=淨(?:收入|營收|收益)(?:保留|留存)率)/gu]
  ]
  for (const [english, chinese] of meetingBoundaries) {
    if (english.test(source) && speechClauses(source).some(clause => clause.trim().match(english)?.index === 0)) {
      result = result.replace(chinese, (_match, last) => `${last}。`)
    }
  }
  const lectureBoundaries = [
    [/\bthis is the end of\b/i, /([\p{Script=Han}\d])\s*(?=這是[^。！？；，]{0,24}(?:結束|結尾))/gu],
    [/\btoday we are discussing\b/i, /([\p{Script=Han}\d])\s*(?=(?:今天)?我們(?:今天)?(?:正在)?討論)/gu],
    [/\bsolar panels (?:convert|turn)\b/i, /([\p{Script=Han}\d])\s*(?=太陽能(?:電池)?板(?:將|把|可|能))/gu],
    [/\ba school can\b/i, /([\p{Script=Han}\d])\s*(?=學校(?:可以|能夠|可|能))/gu],
    [/\bbatteries can\b/i, /([\p{Script=Han}\d])\s*(?=電池(?:可以|能夠|可|能))/gu],
    [/\bstudents can\b/i, /([\p{Script=Han}\d])\s*(?=學生(?:可以|能夠|可|能))/gu],
    [/\bcollecting rainwater\b/i, /([\p{Script=Han}\d])\s*(?=收集雨水)/gu]
  ]
  for (const [english, chinese] of lectureBoundaries) if (english.test(source)) separate(chinese)
  if (complete && /[\p{Script=Han}\d]$/u.test(result)) result += /\?\s*$/.test(source) ? '？' : /!\s*$/.test(source) ? '！' : '。'
  return result
}
