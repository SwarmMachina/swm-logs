import assert from 'node:assert/strict'
import { test } from 'node:test'

import { verifyPackedFiles } from '../../scripts/build-release-artifact.js'
import { isMissingPublishedPackage } from '../../scripts/publish-release-artifact.js'
import { verifyReleaseMetadata } from '../../scripts/verify-release.js'

const manifest = {
  name: '@swarmmachina/swm-logs',
  packageManager: 'pnpm@11.15.1',
  version: '0.1.0'
}

test('release metadata requires a matching semver tag and pinned pnpm', () => {
  assert.deepEqual(verifyReleaseMetadata({ manifest, tag: 'v0.1.0' }), {
    name: '@swarmmachina/swm-logs',
    tag: 'v0.1.0',
    version: '0.1.0'
  })

  assert.throws(() => verifyReleaseMetadata({ manifest, tag: 'v0.1.1' }), /tag mismatch/)
  assert.throws(() => verifyReleaseMetadata({ manifest: { ...manifest, version: 'next' } }), /invalid release version/)
  assert.throws(() => verifyReleaseMetadata({ manifest: { ...manifest, packageManager: 'pnpm@latest' } }), /must pin/)
})

test('release tarball accepts only package roots, dist, and src', () => {
  const required = [
    'LICENSE',
    'README.md',
    'package.json',
    'dist/index.d.ts',
    'dist/index.js',
    'dist/logger.d.ts',
    'dist/logger.js',
    'src/index.ts',
    'src/logger.ts'
  ].map((path) => ({ path }))

  assert.doesNotThrow(() => verifyPackedFiles(required))
  assert.throws(() => verifyPackedFiles(required.filter(({ path }) => path !== 'dist/index.js')), /missing/)
  assert.throws(() => verifyPackedFiles([...required, { path: 'tests/secret.test.ts' }]), /unexpected file/)
})

test('npm missing-package detection accepts E404 only', () => {
  assert.equal(isMissingPublishedPackage('npm error code E404'), true)
  assert.equal(isMissingPublishedPackage('npm error code E401'), false)
})
