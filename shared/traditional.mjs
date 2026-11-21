import { Converter } from './vendor/opencc-cn2t.mjs'

export const traditional = Converter({ from: 'cn', to: 'twp' })

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
