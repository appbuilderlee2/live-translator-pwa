export function slowWorkerNavigation(navigation) {
  if (!navigation) return false
  return navigation.workerStart > 0 && navigation.fetchStart - navigation.workerStart > 3000 ||
    navigation.responseStart > 0 && navigation.responseEnd - navigation.responseStart > 10000 &&
    navigation.encodedBodySize > 0 && navigation.encodedBodySize < 65536
}

async function bounded(operation, timeout) {
  let timer
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Service worker operation timed out')), timeout)
    })])
  } finally { clearTimeout(timer) }
}

export async function registerServiceWorker({ serviceWorker, navigation, storage, now = Date.now(), timeout = 4000 }) {
  if (!serviceWorker) return 'unsupported'
  const options = { scope: '/', updateViaCache: 'none' }
  try {
    if (!slowWorkerNavigation(navigation)) {
      await bounded(serviceWorker.register('/sw.js', options), timeout)
      return 'registered'
    }
    try {
      const last = Number(storage?.getItem('lt-sw-recovery-at'))
      if (last > 0 && now - last >= 0 && now - last < 60000) return 'throttled'
      storage?.setItem('lt-sw-recovery-at', String(now))
    } catch {}
    const registration = await bounded(Promise.resolve().then(() => serviceWorker.getRegistration('/')), timeout).catch(() => null)
    try { if (registration) await bounded(registration.update(), timeout) } catch {}
    await bounded(serviceWorker.register(`/sw.js?recovery=${now}`, options), timeout)
    return 'recovered'
  } catch { return 'failed' }
}

export function startServiceWorker({ window = globalThis.window, navigator = globalThis.navigator, performance = globalThis.performance } = {}) {
  if (!window || !navigator?.serviceWorker) return
  const start = () => {
    let storage
    try { storage = window.localStorage } catch {}
    void registerServiceWorker({ serviceWorker: navigator.serviceWorker, navigation: performance.getEntriesByType('navigation')[0], storage })
  }
  if (window.document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}
