import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { translateHandler } from './shared/translate.mjs'
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' }
export function createAppServer({ directory = 'dist', translate = translateHandler, timeout = 30000 } = {}) {
const root = resolve(directory)
return http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/api/translate') {
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort(new DOMException('Translation request timed out', 'TimeoutError'))
        if (res.headersSent) res.destroy()
        else {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '5', Connection: 'close' })
          res.end(JSON.stringify({ error: 'translation_timeout' }))
        }
      }, timeout)
      res.once('close', () => { clearTimeout(timer); controller.abort() })
      let size = 0; const chunks = []
      for await (const chunk of req) { size += chunk.length; if (size > 100000) { res.writeHead(400); res.end('Request too large'); return } chunks.push(chunk) }
      const response = await translate(new Request(url, { method: req.method, headers: req.headers, signal: controller.signal, ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }) }))
      if (res.destroyed || res.writableEnded) return
      res.writeHead(response.status, Object.fromEntries(response.headers))
      if (response.body) Readable.fromWeb(response.body, { signal: controller.signal }).on('error', () => res.destroy()).pipe(res); else res.end()
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
    let file = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (!file.startsWith(root + '/') && file !== root) { res.writeHead(403); res.end(); return }
    try { if (!(await stat(file)).isFile()) file = resolve(root, 'index.html') } catch { file = resolve(root, 'index.html') }
    const contents = await readFile(file)
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': contents.length, 'Cache-Control': extname(file) === '.html' ? 'no-store' : file.endsWith('sw.js') || file.endsWith('registerSW.js') ? 'no-cache' : 'public, max-age=3600' })
    res.end(req.method === 'HEAD' ? undefined : contents)
  } catch { if (res.destroyed || res.writableEnded) return; if (!res.headersSent) res.writeHead(500); res.end('Server error') }
})
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) createAppServer().listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`Live Translator listening on http://localhost:${process.env.PORT || 3000}`))
