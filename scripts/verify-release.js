import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { root } from './project-root.js'

const tag = process.argv[2]
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const expected = `v${manifest.version}`

if (tag !== expected) {
  console.error(`[release] tag mismatch: expected ${expected}, got ${String(tag)}`)
  process.exitCode = 1
} else {
  console.log(`[release] verified ${manifest.name}@${manifest.version} (${tag})`)
}
