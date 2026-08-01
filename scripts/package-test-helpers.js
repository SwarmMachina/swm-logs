import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { root } from './project-root.js'

/**
 * Creates an owned temporary directory for package verification.
 * @param {string} prefix
 * @returns {string}
 */
function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

/**
 * Packs the current package and returns pnpm's file manifest plus its path.
 * @param {string} destination
 * @returns {{ filename: string, files: Array<{ path: string }>, path: string }}
 */
function pack(destination) {
  const output = execFileSync('pnpm', ['pack', '--json', '--pack-destination', destination], {
    cwd: root,
    encoding: 'utf8'
  })
  const result = JSON.parse(output)

  return { ...result, path: join(destination, basename(result.filename)) }
}

export { makeTempDir, pack }
