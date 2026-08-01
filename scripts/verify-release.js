import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { root } from './project-root.js'

const VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/**
 * @param {object} params
 * @param {Record<string, unknown>} params.manifest
 * @param {string|undefined} params.tag
 * @returns {{ name: string, version: string, tag: string|null }}
 */
function verifyReleaseMetadata({ manifest, tag }) {
  const name = manifest.name
  const version = manifest.version

  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('package.json must contain a package name')
  }

  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new Error(`package.json contains an invalid release version: ${String(version)}`)
  }

  if (!/^pnpm@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(manifest.packageManager ?? ''))) {
    throw new Error(`package.json must pin pnpm in packageManager, got ${String(manifest.packageManager)}`)
  }

  if (tag !== undefined && tag !== '') {
    const expectedTag = `v${version}`

    if (tag !== expectedTag) {
      throw new Error(`release tag mismatch: expected ${expectedTag}, got ${tag}`)
    }
  }

  return { name, version, tag: tag || null }
}

/**
 * @param {string|undefined} tag
 * @returns {Promise<{ name: string, version: string, tag: string|null }>}
 */
async function verifyRepositoryRelease(tag) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))

  try {
    execFileSync('pnpm', ['install', '--lockfile-only', '--frozen-lockfile', '--ignore-scripts'], {
      cwd: root,
      stdio: 'ignore'
    })
  } catch {
    throw new Error('pnpm-lock.yaml does not match package.json')
  }

  return verifyReleaseMetadata({ manifest, tag })
}

/** @returns {Promise<void>} */
async function main() {
  const { name, version, tag } = await verifyRepositoryRelease(process.argv[2])

  console.log(`[release] metadata verified: ${name}@${version}${tag ? ` (${tag})` : ''}`)
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  main().catch((error) => {
    console.error(`[release] ${error.message}`)
    process.exitCode = 1
  })
}

export { verifyReleaseMetadata, verifyRepositoryRelease }
