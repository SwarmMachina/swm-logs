import { DEFAULT_BUFFER_BYTES, DEFAULT_FLUSH_INTERVAL } from '../constants.js'
import type { BufferingOptions, DeliveryStats, LoggerOptions, LogTransport } from '../types.js'
import type { LevelRegistry } from '../level-registry.js'
import { assertRecord, isFunction, isRecord, nonNegativeInteger, positiveInteger } from '../validation.js'
import { BufferedWriter } from './buffered-writer.js'
import { DeliveryMonitor } from './delivery-monitor.js'
import { OutputDestination } from './output-destination.js'

type OutputOptions = Pick<LoggerOptions, 'buffering' | 'console' | 'destination' | 'onDestinationError' | 'transports'>

function normalizeTransports(transports: readonly LogTransport[] | undefined): readonly LogTransport[] {
  if (transports === undefined) {
    return []
  }

  if (!Array.isArray(transports)) {
    throw new TypeError('options.transports must be an array')
  }

  for (const [index, transport] of transports.entries()) {
    if (!isRecord(transport) || !isFunction(transport.write)) {
      throw new TypeError(`options.transports[${index}] must be an object with write(line, level)`)
    }
  }

  return transports
}

function normalizeBuffering(
  buffering: LoggerOptions['buffering'],
  levels: LevelRegistry
): { flushInterval: number; flushLevel: number; maxBytes: number } | null {
  if (buffering === undefined || buffering === false) {
    return null
  }

  if (buffering !== true) {
    assertRecord(buffering, 'options.buffering')
  }

  const source: BufferingOptions = buffering === true ? {} : buffering

  return {
    flushInterval: nonNegativeInteger(source.flushInterval, DEFAULT_FLUSH_INTERVAL, 'buffering.flushInterval'),
    flushLevel: levels.resolve(source.flushLevel ?? 'warn', 'buffering.flushLevel').value,
    maxBytes: positiveInteger(source.maxBytes, DEFAULT_BUFFER_BYTES, 'buffering.maxBytes')
  }
}

/** Owns the configured output graph, its lifecycle, and shared delivery counters. */
class OutputPipeline {
  readonly #immediateDestination: OutputDestination | null
  readonly #monitor: DeliveryMonitor
  readonly #outputs: readonly (BufferedWriter | LogTransport)[]

  constructor(options: OutputOptions, levels: LevelRegistry) {
    this.#monitor = new DeliveryMonitor(options.onDestinationError)

    if (options.console !== undefined && typeof options.console !== 'boolean') {
      throw new TypeError('options.console must be a boolean')
    }

    const consoleEnabled = options.console ?? true
    const transports = normalizeTransports(options.transports)

    if (!consoleEnabled && options.destination !== undefined) {
      throw new TypeError('options.destination requires options.console to be enabled')
    }

    if (!consoleEnabled && options.buffering !== undefined && options.buffering !== false) {
      throw new TypeError('options.buffering requires options.console to be enabled')
    }

    if (!consoleEnabled && transports.length === 0) {
      throw new TypeError('options.console false requires at least one transport')
    }

    let bufferedWriter: BufferedWriter | null = null
    let immediateDestination: OutputDestination | null = null

    if (consoleEnabled) {
      const destination = new OutputDestination(options.destination)
      const buffering = normalizeBuffering(options.buffering, levels)

      if (buffering === null) {
        immediateDestination = destination
      } else {
        bufferedWriter = new BufferedWriter(destination, buffering, this.#monitor)
      }
    }

    this.#immediateDestination = immediateDestination
    this.#outputs = Object.freeze(bufferedWriter === null ? [...transports] : [bufferedWriter, ...transports])
  }

  write(line: string, level: number): void {
    if (this.#immediateDestination !== null) {
      try {
        this.#immediateDestination.write(line)
      } catch (error) {
        this.#monitor.record(error, 'write', line, 1)
      }
    }

    for (const output of this.#outputs) {
      try {
        output.write(line, level)
      } catch (error) {
        this.#monitor.record(error, 'write', line, 1)
      }
    }
  }

  flush(): void | Promise<void> {
    const pending: Promise<void>[] = []

    for (const output of this.#outputs) {
      this.#collectFlush(output, pending)
    }

    if (pending.length > 0) {
      return Promise.all(pending).then(() => undefined)
    }
  }

  flushSync(): void {
    for (const output of this.#outputs) {
      this.#callFlushSync(output)
    }
  }

  close(): void | Promise<void> {
    const pending: Promise<void>[] = []

    for (const output of this.#outputs) {
      this.#collectClose(output, pending)
    }

    if (pending.length > 0) {
      return Promise.all(pending).then(() => undefined)
    }
  }

  deliveryStats(): DeliveryStats {
    return this.#monitor.snapshot()
  }

  #callFlushSync(target: BufferedWriter | LogTransport): void {
    if (!isFunction(target.flushSync)) {
      return
    }

    try {
      target.flushSync()
    } catch (error) {
      this.#monitor.record(error, 'flushSync')
    }
  }

  #collectFlush(target: BufferedWriter | LogTransport, pending: Promise<void>[]): void {
    if (!isFunction(target.flush)) {
      return
    }

    try {
      this.#collectPromise(target.flush(), 'flush', pending)
    } catch (error) {
      this.#monitor.record(error, 'flush')
    }
  }

  #collectClose(target: BufferedWriter | LogTransport, pending: Promise<void>[]): void {
    if (!isFunction(target.close)) {
      if (isFunction(target.flush)) {
        this.#collectFlush(target, pending)
      } else {
        this.#callFlushSync(target)
      }

      return
    }

    try {
      this.#collectPromise(target.close(), 'close', pending)
    } catch (error) {
      this.#monitor.record(error, 'close')
    }
  }

  #collectPromise(result: void | Promise<void>, operation: 'flush' | 'close', pending: Promise<void>[]): void {
    if (result === undefined || !isFunction((result as Promise<void>).then)) {
      return
    }

    pending.push(
      Promise.resolve(result).catch((error: unknown) => {
        this.#monitor.record(error, operation)
      })
    )
  }
}

export { OutputPipeline }
