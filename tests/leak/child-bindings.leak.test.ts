import assert from 'node:assert/strict'
import { test } from 'node:test'
import { measureMemoryGrowth } from '@swarmmachina/benchkit/measurement'

import Logger from '../../dist/index.js'

test('transient children do not retain per-child state', async () => {
  assert.equal(typeof globalThis.gc, 'function', 'run with --expose-gc')

  const logger = new Logger({
    destination: { write: () => true },
    level: 'silent'
  })
  const growth = await measureMemoryGrowth({
    iterations: 20,
    warmup: 3,
    run(iteration) {
      for (let index = 0; index < 1_000; index += 1) {
        const child = logger.child({ connectionId: `${iteration}:${index}`, transport: 'ws' })

        child.info({ requestId: index }, 'ignored')
      }
    }
  })

  assert.ok(growth.heapUsed.deltaBytes < 8 * 1024 * 1024, `retained heap grew by ${growth.heapUsed.deltaBytes} bytes`)
})
