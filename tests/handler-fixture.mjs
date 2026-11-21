import { createTranslateHandler } from '../shared/translate.mjs'

export const translateHandler = request => createTranslateHandler({ interval: 0, baseDelay: 0, log: () => {} })(request)
