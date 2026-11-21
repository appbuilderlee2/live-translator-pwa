export function slowWorkerNavigation(navigation) {
  if (!navigation) return false
  if (navigation.workerMatchedSourceType === 'race-network-and-fetch-handler' || navigation.workerMatchedSourceType === 'network') return false
  return navigation.workerStart > 0 && navigation.fetchStart - navigation.workerStart > 3000 ||
    navigation.workerStart === 0 && navigation.responseStart > 0 && navigation.responseEnd - navigation.responseStart >= 85000 &&
    navigation.responseEnd - navigation.responseStart <= 95000 &&
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

export async function registerServiceWorker({ serviceWorker, navigation, storage, timeout = 4000, build = new URL(import.meta.url).pathname.split('/').at(-1) }) {
  if (!serviceWorker) return 'unsupported'
  const options = { scope: '/', updateViaCache: 'none' }
  try {
    if (!slowWorkerNavigation(navigation)) {
      const registration = serviceWorker.getRegistration ? await bounded(serviceWorker.getRegistration('/'), timeout) : null
      if (registration?.active || registration?.installing || registration?.waiting) return 'existing'
      await bounded(serviceWorker.register('/sw.js', options), timeout)
      return 'registered'
    }
    try {
      if (!storage) return 'failed'
      const key = `lt-sw-recovery-build:${build}`
      if (storage.getItem(key)) return 'throttled'
      storage.setItem(key, 'attempted')
    } catch { return 'failed' }
    await bounded(serviceWorker.register(`/sw.js?recovery=${encodeURIComponent(build)}`, options), timeout)
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
