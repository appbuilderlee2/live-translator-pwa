import { numericValues } from '../shared/numbers.mjs'
export { numericValues }

export function recognitionWarnings(segment) {
  const labels = {
    alternatives: '辨識數字可能有誤，候選不一致，請核對原音 / Recognized number may be wrong; alternatives disagree; check the audio',
    interim: '辨識數字曾變動或遺漏，最終辨識也可能有誤，請核對原音 / Recognized figures changed or disappeared; final recognition may be wrong; check the audio',
    boundary: '數字跨越收音中斷，請核對原音 / Figures cross a recognition boundary; check the audio'
  }
  const result = (segment.numericWarnings || []).map(reason => labels[reason]).filter(Boolean)
  const format = values => values.map(value => Math.abs(value) >= 1e6 ? `${Number((value / 1e6).toPrecision(12))}M` : String(value)).join(', ')
  const heard = numericValues(segment.en)
  const alternatives = [...new Set((segment.numericAlternatives || []).filter(values => values.length && values.join() !== heard.join()).map(format))]
  if (alternatives.length) result.push(`辨識 / Heard: ${format(heard)}; 候選 / Alternatives: ${alternatives.join(' / ')}`)
  return result
}
