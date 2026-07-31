import assert from 'node:assert/strict'
import { test } from 'node:test'

import Logger, { ConsoleBridge } from '../../dist/index.js'
import { MemoryDestination } from '../helpers/memory-destination.ts'

type ConsoleMethod = 'trace' | 'debug' | 'log' | 'info' | 'warn' | 'error'
type TestConsole = Pick<Console, ConsoleMethod>

/** Creates a console-like object whose original calls are observable. */
function fakeConsole(): { calls: unknown[][]; target: TestConsole } {
  const calls: unknown[][] = []
  const record =
    (method: ConsoleMethod) =>
    (...args: unknown[]): void => {
      calls.push([method, ...args])
    }
  const target: TestConsole = {
    trace: record('trace'),
    debug: record('debug'),
    log: record('log'),
    info: record('info'),
    warn: record('warn'),
    error: record('error')
  }

  return { calls, target }
}

test('ConsoleBridge maps methods and restores the original console', () => {
  const destination = new MemoryDestination()
  const logger = new Logger({ destination, level: 'trace', time: () => 1 })
  const { calls, target } = fakeConsole()
  const originalLog = target.log
  const bridge = new ConsoleBridge(logger, target as Console).install()

  target.log('hello')
  target.warn('careful')
  bridge.restore()
  target.log('restored')

  assert.deepEqual(
    destination.records().map(({ level, msg }) => ({ level, msg })),
    [
      { level: 30, msg: 'hello' },
      { level: 40, msg: 'careful' }
    ]
  )
  assert.equal(target.log, originalLog)
  assert.deepEqual(calls, [['log', 'restored']])
})

test('ConsoleBridge lifecycle methods are idempotent', () => {
  const logger = new Logger({ destination: new MemoryDestination() })
  const { target } = fakeConsole()
  const bridge = new ConsoleBridge(logger, target as Console)

  assert.equal(bridge.install(), bridge)
  assert.equal(bridge.install(), bridge)
  assert.doesNotThrow(() => bridge.restore())
  assert.doesNotThrow(() => bridge.restore())
})
