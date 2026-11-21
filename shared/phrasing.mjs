const clauseStarts = /\b(?:please|thank you|we need|we are not|we would rather|do not|don't|I would like|my friend needs|we can|there are)\b/i

export function speechClauses(text) {
  return text.split(new RegExp(`(?<=[.!?;])\\s+|(?<!\\b(?:hope|wish|think|believe|said|says|say|that|if|when|because|whether|know)\\s+)(?=${clauseStarts.source})`, 'i')).filter(chunk => chunk.trim())
}

export function readableChinese(source = '', text = '', complete = true) {
  const sentences = source.match(/[.!?](?:\s|$)/g)?.length || 0
  if (sentences < 2 && (source.match(/\b[a-z]+\b/gi)?.length || 0) < 25) return text
  let result = text
  const separate = pattern => {
    result = result.replace(pattern, (match, last, offset) => /(?:希望|認為|覺得|相信|告訴|說|是否|如果|只要|讓|叫|問|知道|以便|以為|想|但|但是|而且|因為|所以|然後|(?:告訴|問|讓|叫)[我你他她])$/.test(result.slice(0, offset + last.length)) ? match : `${match}。`)
  }
  if (/\bwe can\b/i.test(source)) separate(/([\p{Script=Han}\d])(?=我們(?:可以|能夠))/gu)
  if (/\bwe need\b/i.test(source)) separate(/([\p{Script=Han}\d])(?=我們需要)/gu)
  if (/\bI would like\b/i.test(source)) separate(/([\p{Script=Han}\d])(?=我(?:想要|想|希望|要))/gu)
  if (/\bmy friend needs\b/i.test(source)) separate(/([\p{Script=Han}\d])(?=我的朋友(?:需要|想要))/gu)
  if (/\bthere are\b/i.test(source)) separate(/([\p{Script=Han}])(?=有[一二兩三四五六七八九十\d]+(?:個|位|名)?人(?:來|要來|會來))/gu)
  if (complete && /[\p{Script=Han}\d]$/u.test(result)) result += /\?\s*$/.test(source) ? '？' : /!\s*$/.test(source) ? '！' : '。'
  return result
}
