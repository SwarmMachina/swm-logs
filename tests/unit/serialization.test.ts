import assert from 'node:assert/strict'
import { test } from 'node:test'

import Logger, { type LoggerOptions } from '../../dist/index.js'
import { MemoryDestination } from '../helpers/memory-destination.ts'

/** Crosses the type boundary intentionally to exercise runtime validation. */
function invalidOptions(options: unknown): LoggerOptions {
  return options as LoggerOptions
}

/** Logs one deterministic record and parses it. */
function recordFor(fields: Record<string | symbol, unknown>) {
  const destination = new MemoryDestination()
  const logger = new Logger({ destination, time: () => 1 })

  logger.info(fields, 'serialize')

  return destination.records()[0]
}

test('flat strings use well-formed JSON escaping', () => {
  const text = 'quote " slash \\ newline\n separator\u2028 lone\ud800'
  const record = recordFor({ text })

  assert.equal(record.text, text)
})

test('BigInt is a string, symbols are ignored, and non-finite numbers are null', () => {
  const symbol = Symbol('ignored')
  const fields: Record<string | symbol, unknown> = { big: 12n, nested: { big: 13n }, nan: Number.NaN, symbol }

  fields[symbol] = 'symbol-key'

  assert.deepEqual(recordFor(fields), {
    level: 30,
    time: 1,
    msg: 'serialize',
    big: '12',
    nested: { big: '13' },
    nan: null
  })
})

test('nested cycles become [Circular] while repeated references remain objects', () => {
  const cyclic: { self?: unknown; value: number } = { value: 1 }
  const shared = { stable: true }

  cyclic.self = cyclic

  const record = recordFor({ cyclic, first: shared, second: shared })

  assert.equal(record.cyclic.self, '[Circular]')
  assert.deepEqual(record.first, shared)
  assert.deepEqual(record.second, shared)
})

test('toJSON replacements keep native omission and array-null semantics', () => {
  let calls = 0

  const value = {
    toJSON(key: string) {
      calls += 1
      assert.equal(key, '')

      return {
        array: [undefined, Symbol('ignored'), () => 'ignored'],
        omitted: undefined,
        retained: true
      }
    }
  }

  assert.deepEqual(recordFor({ value }).value, {
    array: [null, null, null],
    retained: true
  })
  assert.equal(calls, 1)
})

test('Error serialization includes type, message, stack, custom props, and five causes', () => {
  const sixth = new Error('sixth')
  const fifth = new Error('fifth', { cause: sixth })
  const fourth = new Error('fourth', { cause: fifth })
  const third = new Error('third', { cause: fourth })
  const second = new Error('second', { cause: third })
  const root = new TypeError('root', { cause: second }) as TypeError & { code: string; sequence: bigint }

  root.code = 'E_ROOT'
  root.sequence = 9n

  const record = recordFor({ err: root })

  assert.equal(record.err.type, 'TypeError')
  assert.equal(record.err.message, 'root')
  assert.match(record.err.stack, /TypeError: root/)
  assert.equal(record.err.code, 'E_ROOT')
  assert.equal(record.err.sequence, '9')
  assert.equal(record.err.cause.cause.cause.cause.cause, '[Cause depth exceeded]')
})

test('circular Error causes are contained', () => {
  const error = new Error('loop')

  error.cause = error

  assert.equal(recordFor({ err: error }).err.cause, '[Circular]')
})

test('Error serialization preserves an own __proto__ property', () => {
  const error = new Error('safe')

  Object.defineProperty(error, '__proto__', {
    enumerable: true,
    value: { polluted: true }
  })

  const serialized = recordFor({ err: error }).err

  assert.equal(Object.hasOwn(serialized, '__proto__'), true)
  assert.deepEqual(serialized.__proto__, { polluted: true })
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test('Error causes and custom fields use bounded JSON-safe serialization', () => {
  const cause: { attempt: bigint; self?: unknown } = { attempt: 7n }
  const context: { requestId: bigint; self?: unknown } = { requestId: 9n }
  const shared = { stable: true }
  const error = new Error('failed', { cause }) as Error & {
    context: typeof context
    first: typeof shared
    second: typeof shared
  }

  cause.self = cause
  context.self = context
  error.context = context
  error.first = shared
  error.second = shared

  const record = recordFor({ err: error })

  assert.deepEqual(record.err.cause, { attempt: '7', self: '[Circular]' })
  assert.deepEqual(record.err.context, { requestId: '9', self: '[Circular]' })
  assert.deepEqual(record.err.first, shared)
  assert.deepEqual(record.err.second, shared)
})

test('depthLimit and edgeLimit apply to Error records', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ depthLimit: 1, destination, edgeLimit: 3, time: () => 1 })
  const error = new Error('failed', { cause: new Error('root cause') }) as Error & { code: string }

  error.code = 'E_FAIL'
  logger.error(error)

  assert.deepEqual(destination.records()[0].err, {
    type: 'Error',
    message: 'failed',
    stack: error.stack,
    '...': '2 items not stringified'
  })
})

test('default Error serialization remains active with unrelated keyed serializers', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({
    destination,
    serializers: { request: (value) => value },
    time: () => 1
  })

  logger.error({ err: new Error('failed') })

  assert.equal(destination.records()[0].err.message, 'failed')
})

test('an Error first argument is normalized to err and uses its message', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ destination, time: () => 1 })

  logger.error(new Error('failed'))

  const record = destination.records()[0]

  assert.equal(record.level, 50)
  assert.equal(record.msg, 'failed')
  assert.equal(record.err.message, 'failed')
})

test('depthLimit and edgeLimit bound nested objects and arrays', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ depthLimit: 1, destination, edgeLimit: 2, time: () => 1 })

  logger.info(
    {
      array: [1, 2, 3, 4],
      nested: { first: { beyond: true } },
      wide: { a: 1, b: 2, c: 3 }
    },
    'bounded'
  )

  const record = destination.records()[0]

  assert.deepEqual(record.array, [1, 2, '... 2 items not stringified'])
  assert.equal(record.nested.first, '[Object]')
  assert.deepEqual(record.wide, { a: 1, b: 2, '...': '1 items not stringified' })
})

test('keyed serializers run once for bindings and once per call field', () => {
  const destination = new MemoryDestination()

  let calls = 0

  const logger = new Logger({
    bindings: { account: { id: 1, secret: 'root' } },
    destination,
    serializers: {
      account(value) {
        calls += 1
        assert.ok(typeof value === 'object' && value !== null && 'id' in value)

        return { id: value.id }
      }
    },
    time: () => 1
  })

  assert.equal(calls, 1)
  logger.info('binding only')
  assert.equal(calls, 1)
  logger.info({ account: { id: 2, secret: 'call' } }, 'override')
  assert.equal(calls, 2)
  assert.deepEqual(destination.records()[1].account, { id: 2 })
})

test('serializer failures are contained and invalid limits fail at construction', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({
    destination,
    serializers: {
      payload() {
        throw new Error('serializer exploded')
      }
    },
    time: () => 1
  })

  assert.doesNotThrow(() => logger.info({ payload: true }))
  assert.match(destination.records()[0].logger_error, /serializer exploded/)
  assert.throws(() => new Logger({ depthLimit: 0 }), /depthLimit/)
  assert.throws(() => new Logger({ edgeLimit: 1.5 }), /edgeLimit/)
  assert.throws(() => new Logger({ serializers: { msg: () => 'reserved' } }), /reserved/)
  assert.throws(() => new Logger(invalidOptions({ serializers: [] })), /object of functions/)
  assert.throws(() => new Logger(invalidOptions({ serializers: { value: true } })), /must be a function/)
})
