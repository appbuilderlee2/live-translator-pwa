import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { Readable } from 'node:stream'
import { translateHandler } from './shared/translate.mjs'
const root = resolve('dist')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' }
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/api/translate') {
      const controller = new AbortController()
      res.on('close', () => controller.abort())
      let size = 0; const chunks = []
      for await (const chunk of req) { size += chunk.length; if (size > 100000) { res.writeHead(400); res.end('Request too large'); return } chunks.push(chunk) }
      const response = await translateHandler(new Request(url, { method: req.method, headers: req.headers, signal: controller.signal, ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }) }))
      res.writeHead(response.status, Object.fromEntries(response.headers))
      if (response.body) Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res); else res.end()
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
    let file = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (!file.startsWith(root + '/') && file !== root) { res.writeHead(403); res.end(); return }
    try { if (!(await stat(file)).isFile()) file = resolve(root, 'index.html') } catch { file = resolve(root, 'index.html') }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-store' : file.endsWith('sw.js') || file.endsWith('registerSW.js') ? 'no-cache' : 'public, max-age=3600' })
    res.end(req.method === 'HEAD' ? undefined : await readFile(file))
  } catch { if (!res.headersSent) res.writeHead(500); res.end('Server error') }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`Live Translator listening on http://localhost:${process.env.PORT || 3000}`))
