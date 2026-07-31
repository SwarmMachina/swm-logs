import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
const examples = [...readme.matchAll(/<!-- example:test ([a-z0-9-]+) -->\s*```js\n([\s\S]*?)```/g)]

test('README is the executable source of truth for short examples', () => {
  assert.ok(examples.length >= 4, `expected at least four executable examples, got ${examples.length}`)

  for (const match of examples) {
    const name = match[1]
    const source = match[2]

    assert.ok(name)
    assert.ok(source)

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5_000
    })

    assert.equal(result.status, 0, `${name}: ${result.stderr}`)
  }
})
