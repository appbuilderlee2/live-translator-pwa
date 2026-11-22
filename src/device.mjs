export function createDeviceTranslator(api) {
  const options = { sourceLanguage: 'en', targetLanguage: 'zh-Hant' }
  const listeners = new Set()
  let value = { status: api ? 'checking' : 'unsupported', progress: 0 }
  let availability; let probePromise; let creating; let translator
  const update = (status, progress = 0) => {
    value = { status, progress }
    for (const listener of listeners) listener(value)
  }
  function begin() {
    if (translator) return Promise.resolve(translator)
    if (creating) return creating
    if (!api || availability === 'unavailable') return Promise.resolve(null)
    update(availability === 'available' ? 'preparing' : 'downloading')
    try {
      creating = Promise.resolve(api.create({ ...options, monitor(monitor) {
        monitor.addEventListener('downloadprogress', event => { if (!translator) update(event.loaded >= 1 ? 'preparing' : 'downloading', Math.max(0, Math.min(100, Math.round(event.loaded * 100)))) })
      } })).then(result => {
        translator = result
        update('ready', 100)
        return result
      }).catch(() => { update('error'); return null }).finally(() => { creating = undefined })
    } catch { update('error'); return Promise.resolve(null) }
    return creating
  }
  function probe() {
    if (!api) return Promise.resolve('unavailable')
    if (!probePromise) probePromise = Promise.resolve().then(() => api.availability(options)).then(result => {
      availability = result
      update(result)
      if (result === 'available') void begin()
      return result
    }).catch(() => { probePromise = undefined; update('error'); return 'unavailable' })
    return probePromise
  }
  return {
    probe,
    prepare() { return availability ? begin() : probe().then(result => result === 'unavailable' ? null : begin()) },
    current() { return translator || null },
    subscribe(listener) { listeners.add(listener); listener(value); return () => { listeners.delete(listener) } }
  }
}
