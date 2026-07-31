import { writeSync } from 'node:fs'
import pino from 'pino'

import Logger from '@swarmmachina/swm-log'
import type { ImplementationName, ScenarioName } from '../types.js'
import { AcceptTransport } from './accept-transport.js'
import { FdTransport } from './fd-transport.js'

export interface BenchLogger {
  child?(bindings: Record<string, unknown>): BenchLogger
  info(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** Owns one benchmark logger implementation and its synchronous flush capability. */
export class ScenarioLogger {
  readonly #flush: () => void
  readonly logger: BenchLogger

  constructor(implementation: ImplementationName, fd: number, scenario: ScenarioName) {
    if (
      implementation === 'swm' ||
      implementation === 'swm-buffered' ||
      implementation === 'swm-hook' ||
      implementation === 'swm-formatter' ||
      implementation === 'swm-transport' ||
      implementation === 'swm-fanout-3'
    ) {
      const transportOnly = implementation === 'swm-transport' || implementation === 'swm-fanout-3'
      const logger = new Logger({
        buffering: implementation === 'swm-buffered',
        console: !transportOnly,
        destination: transportOnly ? undefined : fd,
        formatter:
          implementation === 'swm-formatter'
            ? (record) =>
                JSON.stringify({
                  level: record.level,
                  time: record.time,
                  ...(record.message === undefined ? {} : { msg: record.message }),
                  ...record.fields
                })
            : undefined,
        hooks: implementation === 'swm-hook' ? { beforeFormat: () => {} } : undefined,
        level: 'trace',
        redact: scenario === 'b7' ? ['users[*].password'] : undefined,
        transports:
          implementation === 'swm-transport'
            ? [new FdTransport(fd)]
            : implementation === 'swm-fanout-3'
              ? [new FdTransport(fd), new AcceptTransport(), new AcceptTransport()]
              : undefined
      })

      this.logger = logger
      this.#flush = () => logger.flushSync()

      return
    }

    if (implementation === 'pino-sync' || implementation === 'pino-async' || implementation === 'pino') {
      const destination = pino.destination({
        dest: fd,
        minLength: implementation === 'pino-async' ? 4_096 : 0,
        sync: implementation !== 'pino-async'
      })

      this.logger = pino(
        { base: null, level: 'trace', redact: scenario === 'b7' ? ['users[*].password'] : undefined },
        destination
      )
      this.#flush = () => destination.flushSync()

      return
    }

    if (implementation === 'console-json') {
      this.logger = {
        error: (...values) => writeConsoleJson(fd, values),
        info: (...values) => writeConsoleJson(fd, values)
      }
      this.#flush = () => {}

      return
    }

    throw new TypeError(`unsupported implementation: ${implementation}`)
  }

  flush(): void {
    this.#flush()
  }
}

function writeConsoleJson(fd: number, values: unknown[]): void {
  const [first, second] = values
  const fields = first !== null && typeof first === 'object' && !(first instanceof Error) ? first : undefined
  const message = fields === undefined ? first : second
  const line = JSON.stringify({ level: 30, time: Date.now(), msg: String(message ?? ''), ...(fields ?? {}) })

  writeSync(fd, `${line}\n`)
}
