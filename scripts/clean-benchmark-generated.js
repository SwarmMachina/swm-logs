import { readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const benchmarkDirectory = resolve(import.meta.dirname, '../benchmark')

cleanGeneratedFiles(benchmarkDirectory)

/**
 * Removes only TypeScript outputs below the owned benchmark directory.
 * @param {string} directory
 * @returns {void}
 */
function cleanGeneratedFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)

    if (entry.isDirectory()) {
      if (entry.name !== 'profiles') {
        cleanGeneratedFiles(path)
      }
    } else if (/\.(?:js|js\.map|d\.ts|d\.ts\.map)$/.test(entry.name)) {
      rmSync(path)
    }
  }
}
