import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/** Runs a fixture with stdout connected directly to a regular file. */
function runCrashFixture(name: string): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'swm-log-crash-'))
  const output = join(directory, 'output.ndjson')
  const descriptor = openSync(output, 'w')

  try {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))],
      {
        encoding: 'utf8',
        stdio: ['ignore', descriptor, 'pipe']
      }
    )

    assert.equal(result.status, 0, result.stderr)
  } finally {
    closeSync(descriptor)
  }

  const lines = readFileSync(output, 'utf8').trimEnd().split('\n')

  rmSync(directory, { force: true, recursive: true })

  return lines
}

/** Verifies every sequential record reached the file. */
function assertComplete(lines: string[]): void {
  assert.equal(lines.length, 10_000)
  const first = lines[0]
  const last = lines.at(-1)

  assert.ok(first)
  assert.ok(last)
  assert.equal(JSON.parse(first).index, 0)
  assert.equal(JSON.parse(last).index, 9_999)
}

test('immediate stdout mode survives process.exit after 10k calls', () => {
  assertComplete(runCrashFixture('crash-child.ts'))
})

test('buffered mode survives process.exit after flushSync', () => {
  assertComplete(runCrashFixture('buffered-crash-child.ts'))
})
