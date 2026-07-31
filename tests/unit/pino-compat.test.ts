import assert from 'node:assert/strict'
import { test } from 'node:test'
import pino, { type Logger as PinoLogger } from 'pino'

import Logger from '../../dist/index.js'
import { MemoryDestination } from '../helpers/memory-destination.ts'

const NOW = 1_710_000_000_000

/** Creates pino with the documented swm-log field order. */
function referencePino(destination: MemoryDestination): PinoLogger {
  return pino(
    {
      base: null,
      level: 'trace',
      timestamp: () => `,"time":${NOW}`,
      hooks: {
        logMethod(args, method) {
          if (args[0] !== null && typeof args[0] === 'object' && typeof args[1] === 'string') {
            method.apply(this, [{ msg: args[1], ...args[0] }])

            return
          }

          method.apply(this, args)
        }
      }
    },
    destination
  )
}

test('B1 string-only output matches pino byte for byte', () => {
  const actual = new MemoryDestination()
  const expected = new MemoryDestination()
  const logger = new Logger({ destination: actual, level: 'trace', time: () => NOW })
  const reference = referencePino(expected)

  logger.info('msg')
  reference.info('msg')

  assert.equal(actual.text(), expected.text())
})

test('B2 flat-object output matches configured pino byte for byte', () => {
  const actual = new MemoryDestination()
  const expected = new MemoryDestination()
  const logger = new Logger({ destination: actual, level: 'trace', time: () => NOW })
  const reference = referencePino(expected)
  const fields = { a: 1, b: 'x', c: true }

  logger.info(fields, 'msg')
  reference.info(fields, 'msg')

  assert.equal(actual.text(), expected.text())
})
