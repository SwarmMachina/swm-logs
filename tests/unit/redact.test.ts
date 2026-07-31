import assert from 'node:assert/strict'
import { test } from 'node:test'

import Logger, { type LoggerOptions } from '../../dist/index.js'
import { MemoryDestination } from '../helpers/memory-destination.ts'

/** Crosses the type boundary intentionally to exercise runtime validation. */
function invalidOptions(options: unknown): LoggerOptions {
  return options as LoggerOptions
}

test('redacts existing paths without mutating caller data', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({
    destination,
    redact: ['req.headers.authorization', 'user.password'],
    time: () => 1
  })
  const fields = {
    req: { headers: { authorization: 'Bearer secret', accept: 'application/json' } },
    user: { id: 7, password: 'secret' }
  }

  logger.info(fields, 'request')

  const record = destination.records()[0]

  assert.equal(record.req.headers.authorization, '[Redacted]')
  assert.equal(record.req.headers.accept, 'application/json')
  assert.equal(record.user.password, '[Redacted]')
  assert.equal(fields.req.headers.authorization, 'Bearer secret')
  assert.equal(fields.user.password, 'secret')
})

test('absent and partially matching paths leave fields unchanged', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ destination, redact: ['req.headers.authorization'], time: () => 1 })

  logger.info({ req: { headers: { authorizationType: 'Bearer' } }, other: true })
  logger.info({ req: null, other: true })

  assert.equal(destination.records()[0].req.headers.authorizationType, 'Bearer')
  assert.equal(destination.records()[1].req, null)
})

test('an empty redact path list is an explicit no-op', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ destination, redact: [], time: () => 1 })

  logger.info({ token: 'visible' })

  assert.equal(destination.records()[0].token, 'visible')
})

test('child bindings are redacted during their one-time serialization', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ destination, redact: ['req.headers.authorization'], time: () => 1 })
  const child = logger.child({ req: { headers: { authorization: 'secret' } } })

  child.info('safe')

  assert.equal(destination.records()[0].req.headers.authorization, '[Redacted]')
})

test('invalid paths fail during configuration', () => {
  assert.throws(() => new Logger(invalidOptions({ redact: 'token' })), /array or an object/)
  assert.throws(() => new Logger({ redact: ['req..token'] }), /empty path segment/)
  assert.throws(() => new Logger({ redact: [''] }), /non-empty string/)
})

test('wildcard and bracket paths redact array members and quoted keys', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({
    destination,
    redact: ['users[*].password', 'req.headers["x-api-key"]'],
    time: () => 1
  })

  logger.info({
    req: { headers: { 'x-api-key': 'secret', accept: 'json' } },
    users: [
      { id: 1, password: 'one' },
      { id: 2, password: 'two' }
    ]
  })

  const record = destination.records()[0]

  assert.equal(record.users[0].password, '[Redacted]')
  assert.equal(record.users[1].password, '[Redacted]')
  assert.equal(record.req.headers['x-api-key'], '[Redacted]')
  assert.equal(record.req.headers.accept, 'json')
})

test('rich redact supports computed censor and key removal', () => {
  const censoredDestination = new MemoryDestination()
  const censored = new Logger({
    destination: censoredDestination,
    redact: {
      censor: (value, path) => `${path.join('/')}:${String(value).length}`,
      paths: ['users.*.token']
    },
    time: () => 1
  })

  censored.info({ users: { admin: { token: 'abcd' } } })
  assert.equal(censoredDestination.records()[0].users.admin.token, 'users/admin/token:4')

  const removedDestination = new MemoryDestination()
  const removed = new Logger({
    destination: removedDestination,
    redact: { paths: ['auth.password'], remove: true },
    time: () => 1
  })

  removed.info({ auth: { password: 'secret', user: 'Ada' } })
  assert.deepEqual(removedDestination.records()[0].auth, { user: 'Ada' })
})

test('a computed single-path censor keeps wildcard paths in extension records', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({
    destination,
    hooks: { beforeFormat() {} },
    redact: {
      censor: (value, path) => `${path.join('/')}:${String(value).length}`,
      paths: ['users[*].token']
    },
    time: () => 1
  })
  const fields = { users: [{ token: 'one' }, { token: 'two' }] }

  logger.info(fields)

  assert.deepEqual(destination.records()[0].users, [{ token: 'users/0/token:3' }, { token: 'users/1/token:3' }])
  assert.deepEqual(fields, { users: [{ token: 'one' }, { token: 'two' }] })
})

test('single-path redaction preserves own __proto__ properties without prototype pollution', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({
    destination,
    hooks: { beforeFormat() {} },
    redact: ['payload.__proto__.secret'],
    time: () => 1
  })
  const fields = JSON.parse('{"payload":{"__proto__":{"secret":"hide","retained":true}}}')

  logger.info(fields)

  const payload = destination.records()[0].payload as Record<string, unknown>

  assert.equal(Object.hasOwn(payload, '__proto__'), true)
  assert.deepEqual(payload.__proto__, { retained: true, secret: '[Redacted]' })
  assert.equal(({} as Record<string, unknown>).secret, undefined)
})

test('redaction happens before selected toJSON methods can observe values', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ destination, redact: ['payload.secret'], time: () => 1 })
  const payload = {
    secret: 'must-not-leak',
    toJSON() {
      return this.secret
    }
  }

  logger.info({ payload })

  assert.equal(destination.records()[0].payload, '[Redacted]')
  assert.equal(payload.secret, 'must-not-leak')
})
