import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'

import { makeTempDir, pack, root } from './package-test-helpers.js'

const temporaryDirectory = makeTempDir('swm-log-package-')

try {
  const result = pack(temporaryDirectory)
  const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
  const files = new Set(result.files.map((entry) => entry.path))

  for (const required of [
    'package.json',
    'README.md',
    'LICENSE',
    'dist/index.js',
    'dist/index.d.ts',
    'src/index.ts',
    'dist/logger.js',
    'dist/logger.d.ts',
    'src/logger.ts'
  ]) {
    assert.ok(files.has(required), `tarball is missing ${required}`)
  }

  assert.equal(files.has('tests/unit/logger.test.ts'), false, 'tarball must not contain tests')
  assert.equal(files.has('benchmark/bench.js'), false, 'tarball must not contain benchmarks')
  assert.deepEqual(manifest.dependencies, undefined, 'package must have zero runtime dependencies')
  assert.equal(manifest.exports['.'].types, './dist/index.d.ts')
  assert.equal(manifest.exports['.'].import, './dist/index.js')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.engines.node, '22.x || 24.x')

  console.log('package metadata and tarball contents: ok')
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
