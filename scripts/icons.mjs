import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
await mkdir('public', { recursive: true })
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#c8ef99"/><g fill="none" stroke="#203b25" stroke-width="23" stroke-linecap="round" stroke-linejoin="round"><path d="M130 165h142M201 128v37M158 166c0 66 44 111 113 140M247 166c-8 66-53 116-112 143M277 367l56-150 57 150M297 319h74"/></g></svg>`
for (const [name, size] of [['icon-192.png',192],['icon-512.png',512],['maskable-512.png',512],['apple-touch-icon.png',180]]) await sharp(Buffer.from(svg)).resize(size,size).png().toFile(`public/${name}`)
