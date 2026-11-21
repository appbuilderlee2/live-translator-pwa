const clauseStarts = /\b(?:please|thank you|we need|we are not|we would rather|do not|don't|I would like|my friend needs|we can|there are|revenue was|this year revenue|gross margin|net revenue retention)\b/i

export function speechClauses(text) {
  return text.split(new RegExp(`(?<=[.!?;])\\s+|(?<!\\b(?:hope|wish|think|believe|said|says|say|that|if|when|because|whether|know)\\s+)(?=${clauseStarts.source})`, 'i')).filter(chunk => chunk.trim())
}

export function readableChinese(source = '', text = '', complete = true) {
  if (/[$€£]|\b(?:dollars?|USD|TWD|euros?|yen)\b/i.test(source)) text = text.replace(/(\d)[，,]\s*(?=(?:美|加|澳|港|新臺|新台|日|歐)?元)/g, '$1')
  text = text.replace(/(^|[，。；！？])\s*請。\s*(?=[\p{Script=Han}])/gu, '$1請')
  const sentences = source.match(/[.!?](?:\s|$)/g)?.length || 0
  const long = sentences >= 2 || (source.match(/\b[a-z]+\b/gi)?.length || 0) >= 25 || (text.match(/\p{Script=Han}/gu)?.length || 0) >= 40
  let result = text
  const separate = pattern => {
    result = result.replace(pattern, (match, last, offset) => /(?:希望|認為|覺得|相信|告訴|說|是否|如果|只要|讓|叫|問|知道|以便|以為|想|但|但是|而且|因為|所以|然後|(?:告訴|問|讓|叫)[我你他她])$/.test(result.slice(0, offset + last.length)) ? match : `${last}。`)
  }
  if (long) {
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
  }
  const lectureBoundaries = [
    [/\bresult is not a failure\b|\b(?:a|the)\s+(?:[a-z-]+\s+){0,3}result is\b/i, /([\p{Script=Han}\d])(?:\s+(?=(?:[\p{Script=Han}]{1,12}的)?結果(?:並)?(?:不是|是))|\s*(?=令人(?:驚訝|意外)的結果(?:並)?(?:不是|是)))/gu],
    [/\bthis is the end of\b/i, /([\p{Script=Han}\d])\s*(?=這是[^。！？；，]{0,24}(?:結束|結尾))/gu],
    [/\btoday we are discussing\b/i, /([\p{Script=Han}\d])(?<!今天)\s*(?=(?:今天)?我們(?:今天)?(?:正在)?討論)/gu],
    [/\ba scientific experiment begins\b/i, /([\p{Script=Han}\d])\s*(?=科學實驗從)/gu],
    [/\bwe change one factor\b/i, /([\p{Script=Han}\d])\s*(?=我們改變一個因素)/gu],
    [/\bsolar panels (?:convert|turn)\b/i, /([\p{Script=Han}\d])\s*(?=太陽能(?:電池)?板(?:將|把|可|能))/gu],
    [/\ba school can\b/i, /([\p{Script=Han}\d])\s*(?=學校(?:可以|能夠|可|能))/gu],
    [/\bbatteries can\b/i, /([\p{Script=Han}\d])\s*(?=電池(?:可以|能夠|可|能))/gu],
    [/\bstudents can\b/i, /([\p{Script=Han}\d])\s*(?=學生(?:可以|能夠|可|能))/gu],
    [/\bcollecting rainwater\b/i, /([\p{Script=Han}\d])\s*(?=收集雨水)/gu]
  ]
  for (const [english, chinese] of lectureBoundaries) if (english.test(source)) separate(chinese)
  if (!long && result === text) return text
  if (/\b(?:do not|don't|never) take more than\b/i.test(source)) separate(/([\p{Script=Han}])[，,\s]*(?=\d+\s*小時內(?:不要|不可|不得|勿|別))/gu)
  if (/\bbefore taking (?:this |the )?medicine\b/i.test(source)) separate(/([\p{Script=Han}\d])[，,\s]*(?=(?:服用(?:此|本|這種|這個)?藥(?:物)?前|用藥前))/gu)
  if (/\bI want to make sure\b/i.test(source)) separate(/([\p{Script=Han}\d])[，,\s]*(?=我想(?:要)?(?:確保|確認))/gu)
  if (complete && !/\b(?:a|an|the)\s+better$/i.test(source.trim()) && /[\p{Script=Han}\d]$/u.test(result)) result += /\?\s*$/.test(source) ? '？' : /!\s*$/.test(source) ? '！' : '。'
  return result
}
