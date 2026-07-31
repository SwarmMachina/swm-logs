import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

export const root = resolve(import.meta.dirname, '..')

/**
 * Creates an owned temporary directory for package verification.
 * @param {string} prefix
 * @returns {string}
 */
export function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

/**
 * Packs the current package and returns pnpm's file manifest plus its path.
 * @param {string} destination
 * @returns {{ filename: string, files: Array<{ path: string }>, path: string }}
 */
export function pack(destination) {
  const output = execFileSync('pnpm', ['pack', '--json', '--pack-destination', destination], {
    cwd: root,
    encoding: 'utf8'
  })
  const result = JSON.parse(output)

  return { ...result, path: join(destination, basename(result.filename)) }
}
