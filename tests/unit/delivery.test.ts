import assert from 'node:assert/strict'
import { test } from 'node:test'

import Logger, { type DestinationErrorEvent } from '../../dist/index.js'

function invalidHandler(handler: unknown): (event: DestinationErrorEvent) => void {
  return handler as (event: DestinationErrorEvent) => void
}

test('destination error handlers are validated during construction', () => {
  assert.throws(() => new Logger({ onDestinationError: invalidHandler({}) }), /onDestinationError must be a function/)
})

test('destination failures expose counters and a contained notification', () => {
  const events: DestinationErrorEvent[] = []
  const logger = new Logger({
    destination: {
      write() {
        throw new Error('disk full')
      }
    },
    onDestinationError(event) {
      events.push(event)
    },
    time: () => 1
  })

  assert.doesNotThrow(() => logger.info('lost'))

  const line = '{"level":30,"time":1,"msg":"lost"}\n'

  assert.deepEqual(logger.deliveryStats(), {
    destinationErrors: 1,
    droppedBytes: Buffer.byteLength(line),
    droppedChunks: 1,
    droppedRecords: 1
  })
  assert.equal(events.length, 1)
  const event = events[0]

  assert.ok(event)
  assert.equal(event.operation, 'write')
  assert.ok(event.error instanceof Error)
  assert.equal(event.error.message, 'disk full')
})

test('buffered failure counts every record in the failed chunk', () => {
  const logger = new Logger({
    buffering: { flushInterval: 0, maxBytes: 4096 },
    destination: {
      write() {
        throw new Error('offline')
      }
    },
    time: () => 1
  })

  logger.info('one')
  logger.info('two')
  logger.flushSync()

  assert.deepEqual(logger.deliveryStats(), {
    destinationErrors: 1,
    droppedBytes: Buffer.byteLength('{"level":30,"time":1,"msg":"one"}\n{"level":30,"time":1,"msg":"two"}\n'),
    droppedChunks: 1,
    droppedRecords: 2
  })
})

test('failure notification is reentrancy-safe and shared with children', () => {
  let notifications = 0

  const logger = new Logger({
    destination: {
      write() {
        throw new Error('unavailable')
      }
    },
    onDestinationError() {
      notifications += 1
      logger.info('nested failure')
      throw new Error('observer failure')
    }
  })
  const child = logger.child({ requestId: 'r1' })

  assert.doesNotThrow(() => child.info('outer failure'))
  assert.equal(notifications, 1)
  assert.equal(logger.deliveryStats().destinationErrors, 2)
  assert.deepEqual(child.deliveryStats(), logger.deliveryStats())
})
