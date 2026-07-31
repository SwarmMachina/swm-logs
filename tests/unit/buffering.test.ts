import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'

import Logger from '../../dist/index.js'
import { MemoryDestination } from '../helpers/memory-destination.ts'

test('buffering retains low-severity lines until flush', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ buffering: { flushInterval: 0, maxBytes: 4096 }, destination, time: () => 1 })

  logger.info('pending')
  assert.equal(destination.text(), '')

  logger.flush()
  assert.equal(destination.records()[0].msg, 'pending')
  logger.close()
})

test('warn and higher levels flush the whole buffer', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ buffering: { flushInterval: 0, maxBytes: 4096 }, destination, time: () => 1 })

  logger.info('first')
  logger.warn('second')

  assert.deepEqual(
    destination.records().map((record) => record.msg),
    ['first', 'second']
  )
  logger.close()
})

test('size threshold and flushSync both drain pending data', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ buffering: { flushInterval: 0, maxBytes: 1 }, destination, time: () => 1 })

  logger.info('size')
  assert.equal(destination.records()[0].msg, 'size')

  const second = new Logger({ buffering: { flushInterval: 0, maxBytes: 4096 }, destination, time: () => 2 })

  second.info('sync')
  second.flushSync()
  assert.equal(destination.records()[1].msg, 'sync')
  second.close()
  logger.close()
})

test('unref timer flushes buffered output', async () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ buffering: { flushInterval: 20, maxBytes: 4096 }, destination, time: () => 1 })

  logger.info('timer')
  await delay(60)

  assert.equal(destination.records()[0].msg, 'timer')
  logger.close()
})
