import assert from 'node:assert/strict'
import { test } from 'node:test'

import Logger, { LEVELS, type LoggerOptions } from '../../dist/index.js'
import { invalidLoggerOptions } from '../helpers/invalid-logger-options.ts'
import { MemoryDestination } from '../helpers/memory-destination.ts'

const NOW = 1_710_000_000_000

/** Creates a deterministic logger and its in-memory destination. */
function setup(options: LoggerOptions = {}): { destination: MemoryDestination; logger: Logger } {
  const destination = new MemoryDestination()
  const logger = new Logger({ destination, time: () => NOW, ...options })

  return { destination, logger }
}

test('writes the specified pino-compatible envelope and flat fields', () => {
  const { destination, logger } = setup()

  logger.info({ a: 1, b: 'x', c: true, empty: null }, 'ready')

  assert.equal(
    destination.text(),
    '{"level":30,"time":1710000000000,"msg":"ready","a":1,"b":"x","c":true,"empty":null}\n'
  )
})

test('filters numeric built-in levels and allows threshold changes', () => {
  const { destination, logger } = setup({ level: 'warn' })

  logger.info('hidden')
  logger.warn('visible')
  logger.level = 'trace'
  logger.trace('trace')

  assert.deepEqual(
    destination.records().map(({ level, msg }) => ({ level, msg })),
    [
      { level: LEVELS.warn, msg: 'visible' },
      { level: LEVELS.trace, msg: 'trace' }
    ]
  )
})

test('logs configured custom levels through the explicit log method', () => {
  const { destination, logger } = setup({ customLevels: { notice: 35 }, level: 'trace' })

  logger.log('notice', 'dynamic')

  assert.equal(logger.isLevelEnabled('notice'), true)
  assert.equal(destination.records()[0].level, 35)
})

test('does not expose pino compatibility-only instance state', () => {
  const { logger } = setup({ customLevels: { notice: 35 } })
  const compatibilityState = logger as unknown as Record<string, unknown>

  assert.equal(compatibilityState.notice, undefined)
  assert.equal(compatibilityState.levels, undefined)
  assert.equal(compatibilityState.levelVal, undefined)
  assert.equal(compatibilityState.version, undefined)
})

test('pre-serializes child bindings exactly once', () => {
  const { destination, logger } = setup({ bindings: { service: 'api' } })
  const connection = { id: 7 }
  const child = logger.child({ connection })

  connection.id = 8
  child.info({ requestId: 'r1' }, 'accepted')

  assert.equal(
    destination.text(),
    '{"level":30,"time":1710000000000,"msg":"accepted","service":"api","connection":{"id":7},"requestId":"r1"}\n'
  )
  assert.deepEqual(child.bindings(), { service: 'api', connection })
})

test('supports pino-like message placeholders without importing node:util', () => {
  const { destination, logger } = setup()

  logger.info('user %s has %d jobs: %j', 'Ada', 3, { active: true })
  logger.info({ requestId: 'r1' }, 'user %s has %d jobs', 'Grace', 2, 'queued')

  assert.equal(destination.records()[0].msg, 'user Ada has 3 jobs: {"active":true}')
  assert.equal(destination.records()[1].msg, 'user Grace has 2 jobs queued')
})

test('reserved envelope keys cannot be spoofed by bindings or fields', () => {
  const { destination, logger } = setup({ bindings: { level: 1, time: 2, msg: 'binding', service: 'api' } })

  logger.info({ level: 2, time: 3, msg: 'field', ok: true })

  assert.deepEqual(destination.records()[0], {
    level: 30,
    time: NOW,
    msg: 'field',
    service: 'api',
    ok: true
  })
})

test('a serialization failure becomes logger_error and never escapes', () => {
  const { destination, logger } = setup()
  const fields = {
    get failure() {
      throw new Error('getter exploded')
    }
  }

  assert.doesNotThrow(() => logger.info(fields, 'unsafe'))
  assert.match(destination.records()[0].logger_error, /getter exploded/)
})

test('a failing destination never escapes a log call', () => {
  const logger = new Logger({
    destination: {
      write() {
        throw new Error('disk failed')
      }
    }
  })

  assert.doesNotThrow(() => logger.error('contained'))
})

test('configuration errors are explicit TypeErrors', () => {
  assert.throws(() => new Logger({ level: 'unknown' }), TypeError)
  assert.throws(() => new Logger({ customLevels: { info: 35 } }), /collides with a built-in level/)
  assert.throws(() => new Logger(invalidLoggerOptions({ customLevels: [] })), /customLevels must be an object/)
  assert.throws(
    () => new Logger(invalidLoggerOptions({ customLevels: { notice: Number.MAX_SAFE_INTEGER + 1 } })),
    /non-negative safe integer/
  )
  assert.throws(() => new Logger({ buffering: { maxBytes: 0 } }), /positive integer/)
  assert.throws(() => new Logger(invalidLoggerOptions({ time: null })), /time must be a function/)
  assert.throws(() => new Logger(invalidLoggerOptions({ console: 'no' })), /console must be a boolean/)
  assert.throws(() => new Logger({ console: false }), /requires at least one transport/)
  assert.throws(
    () => new Logger({ console: false, destination: 'stderr', transports: [{ write() {} }] }),
    /destination/
  )
  assert.throws(() => new Logger({ console: false, buffering: true, transports: [{ write() {} }] }), /buffering/)
  assert.throws(() => new Logger(invalidLoggerOptions({ destination: {} })), /destination/)
  assert.throws(() => new Logger(invalidLoggerOptions({ destination: Number.MAX_SAFE_INTEGER + 1 })), /destination/)
  assert.throws(() => new Logger(invalidLoggerOptions({ bindings: [] })), /must be an object/)
})
