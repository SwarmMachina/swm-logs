import assert from 'node:assert/strict'
import { test } from 'node:test'

import Logger, { type LoggerOptions, type LogTransport } from '../../dist/index.js'
import { MemoryDestination } from '../helpers/memory-destination.ts'

/** Crosses the type boundary intentionally to exercise runtime validation. */
function invalidOptions(options: unknown): LoggerOptions {
  return options as LoggerOptions
}

test('beforeFormat hooks enrich owned records and preserve binding snapshots', () => {
  const destination = new MemoryDestination()
  const binding = { nested: { stable: true } }
  const logger = new Logger({
    bindings: binding,
    destination,
    hooks: {
      beforeFormat: [
        (record) => {
          record.fields.traceId = 't1'
        },
        (record) => {
          record.message = `hooked: ${record.message}`
        }
      ]
    },
    time: () => 1
  })

  binding.nested.stable = false
  logger.child({ requestId: 'r1' }).info({ ready: true }, 'start')

  assert.deepEqual(destination.records()[0], {
    level: 30,
    time: 1,
    msg: 'hooked: start',
    nested: { stable: true },
    ready: true,
    requestId: 'r1',
    traceId: 't1'
  })
})

test('hooks can drop records or replace a formatted line', () => {
  const destination = new MemoryDestination()
  const dropped = new Logger({
    destination,
    hooks: { beforeFormat: () => false },
    time: () => 1
  })

  dropped.info('hidden')
  assert.equal(destination.text(), '')

  const replaced = new Logger({
    destination,
    hooks: { afterFormat: (_line, record) => `level=${record.levelLabel} msg=${record.message}` },
    time: () => 2
  })

  replaced.warn('visible')
  assert.equal(destination.text(), 'level=warn msg=visible\n')
})

test('custom formatter receives redacted and serialized fields', () => {
  const destination = new MemoryDestination()
  const error = new Error('failed') as Error & { self: unknown; sequence: bigint }

  error.sequence = 9n
  error.self = error

  const logger = new Logger({
    destination,
    formatter(record) {
      const user = record.fields.user as Record<string, unknown>
      const err = record.fields.err as Record<string, unknown>

      assert.equal(user.password, '[Redacted]')
      assert.deepEqual(record.fields.account, { id: 7 })
      assert.equal(err.type, 'Error')
      assert.equal(err.sequence, '9')
      assert.equal(err.self, '[Circular]')

      return `${record.time} ${record.levelLabel.toUpperCase()} ${record.message}`
    },
    redact: ['user.password'],
    serializers: {
      account(value) {
        assert.ok(typeof value === 'object' && value !== null && 'id' in value)

        return { id: value.id }
      }
    },
    time: () => 3
  })

  logger.error(
    {
      account: { id: 7, token: 'secret' },
      err: error,
      user: { password: 'secret' }
    },
    'request failed'
  )

  assert.equal(destination.text(), '3 ERROR request failed\n')
})

test('extension fields preserve an own __proto__ key without changing the record prototype', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({
    destination,
    formatter(record) {
      assert.equal(Object.getPrototypeOf(record.fields), Object.prototype)
      assert.equal(Object.hasOwn(record.fields, '__proto__'), true)
      assert.deepEqual(record.fields.__proto__, { polluted: true })

      return '{}'
    }
  })
  const fields = JSON.parse('{"__proto__":{"polluted":true}}')

  logger.info(fields)

  assert.equal(destination.text(), '{}\n')
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test('extension failures become logger_error records and never escape', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({
    destination,
    hooks: {
      beforeFormat() {
        throw new Error('hook exploded')
      }
    },
    time: () => 1
  })

  assert.doesNotThrow(() => logger.info('work'))
  assert.match(destination.records()[0].logger_error, /hook exploded/)
})

test('fans each record out to console and multiple fire-and-forget transports', async () => {
  class TestTransport implements LogTransport {
    readonly calls: (string | number)[][] = []

    write(line: string, level: number): void {
      this.calls.push(['write', line, level])
    }

    flush(): void {
      this.calls.push(['flush'])
    }

    flushSync(): void {
      this.calls.push(['flushSync'])
    }

    close(): void {
      this.calls.push(['close'])
    }
  }

  const destination = new MemoryDestination()
  const wal = new TestTransport()
  const database = new TestTransport()
  const http = new TestTransport()
  const logger = new Logger({ destination, time: () => 1, transports: [wal, database, http] })

  logger.warn('queued')
  await logger.flush()
  logger.flushSync()
  await logger.close()

  assert.equal(destination.records()[0].msg, 'queued')

  for (const transport of [wal, database, http]) {
    assert.deepEqual(transport.calls, [
      ['write', '{"level":40,"time":1,"msg":"queued"}\n', 40],
      ['flush'],
      ['flushSync'],
      ['close']
    ])
  }
})

test('console false sends records only to transports', () => {
  const lines: string[] = []
  const logger = new Logger({
    console: false,
    time: () => 1,
    transports: [{ write: (line) => lines.push(line) }]
  })

  logger.info('transport only')

  assert.deepEqual(lines, ['{"level":30,"time":1,"msg":"transport only"}\n'])
})

test('one synchronous transport failure does not block later transports', () => {
  const lines: string[] = []
  const logger = new Logger({
    console: false,
    transports: [
      {
        write() {
          throw new Error('queue closed')
        }
      },
      { write: (line) => lines.push(line) }
    ]
  })

  assert.doesNotThrow(() => logger.info('kept'))
  assert.equal(lines.length, 1)
  assert.equal(logger.deliveryStats().destinationErrors, 1)
})

test('extension configuration is validated once during construction', () => {
  assert.throws(() => new Logger(invalidOptions({ formatter: 'pretty' })), /formatter/)
  assert.throws(() => new Logger(invalidOptions({ hooks: null })), /hooks/)
  assert.throws(() => new Logger(invalidOptions({ hooks: { beforeFormat: [null] } })), /beforeFormat/)
  assert.throws(() => new Logger(invalidOptions({ transports: {} })), /transports must be an array/)
  assert.throws(() => new Logger(invalidOptions({ transports: [{}] })), /transports\[0\]/)
})

test('async transport lifecycle can be awaited and rejected work is contained', async () => {
  const logger = new Logger({
    console: false,
    transports: [
      {
        async flush() {
          throw new Error('async flush failed')
        },
        write() {}
      }
    ]
  })

  await assert.doesNotReject(async () => logger.flush())
  assert.equal(logger.deliveryStats().destinationErrors, 1)
  await assert.doesNotReject(async () => logger.close())
  assert.equal(logger.deliveryStats().destinationErrors, 2)
})
