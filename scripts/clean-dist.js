import { rmSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const target = resolve(root, 'dist')

if (relative(root, target) !== 'dist') {
  throw new Error(`refusing to clean unexpected path: ${target}`)
}

rmSync(target, { force: true, recursive: true })
