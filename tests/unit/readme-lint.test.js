import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extractCodeExamples } from '../../scripts/lint-readme-examples.js'

test('README lint extraction includes JavaScript and TypeScript fences only', () => {
  const markdown = [
    '```js',
    'const js = true',
    '```',
    '```ts',
    'const ts: boolean = true',
    '```',
    '```sql',
    'SELECT 1;',
    '```'
  ].join('\n')

  assert.deepEqual(extractCodeExamples(markdown), [
    { language: 'js', source: 'const js = true\n' },
    { language: 'ts', source: 'const ts: boolean = true\n' }
  ])
})
