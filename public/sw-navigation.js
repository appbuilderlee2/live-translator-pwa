self.addEventListener('install', event => {
  if (typeof event.addRoutes !== 'function') return
  try {
    event.waitUntil(Promise.resolve(event.addRoutes({
      condition: { requestMode: 'navigate' },
      source: 'race-network-and-fetch-handler'
    })).catch(() => {}))
  } catch {}
})
