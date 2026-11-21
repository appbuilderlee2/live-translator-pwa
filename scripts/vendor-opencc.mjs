import { copyFile, mkdir } from 'node:fs/promises'

await mkdir('shared/vendor', { recursive: true })
await copyFile('node_modules/opencc-js/dist/esm/cn2t.js', 'shared/vendor/opencc-cn2t.mjs')
await copyFile('node_modules/opencc-js/LICENSE', 'shared/vendor/OPENCC-LICENSE')
await copyFile('node_modules/opencc-js/LICENSES/Apache-2.0.txt', 'shared/vendor/Apache-2.0.txt')
await copyFile('node_modules/opencc-js/THIRD_PARTY_LICENSES.md', 'shared/vendor/OPENCC-THIRD-PARTY-LICENSES.md')
