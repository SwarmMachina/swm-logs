import type { OutputDestination } from './output-destination.js'
import type { DeliveryMonitor } from './delivery-monitor.js'

interface NormalizedBufferingOptions {
  maxBytes: number
  flushInterval: number
  flushLevel: number
}

/** Owns the bounded opt-in string buffer and its unref'ed flush timer. */
class BufferedWriter {
  #buffer = ''
  #bytes = 0
  #records = 0
  readonly #destination: OutputDestination
  readonly #flushLevel: number
  readonly #maxBytes: number
  readonly #monitor: DeliveryMonitor
  #timer: NodeJS.Timeout | undefined

  constructor(destination: OutputDestination, options: NormalizedBufferingOptions, monitor: DeliveryMonitor) {
    this.#destination = destination
    this.#maxBytes = options.maxBytes
    this.#flushLevel = options.flushLevel
    this.#monitor = monitor

    if (options.flushInterval > 0) {
      const reference = new WeakRef(this)
      const timer = setInterval(() => {
        const writer = reference.deref()

        if (writer === undefined) {
          clearInterval(timer)
        } else {
          writer.flush()
        }
      }, options.flushInterval)

      timer.unref()
      this.#timer = timer
    }
  }

  /** Buffers one line and flushes on size or severity. */
  write(line: string, level: number): void {
    this.#buffer += line
    this.#bytes += Buffer.byteLength(line)
    this.#records += 1

    if (this.#bytes >= this.#maxBytes || level >= this.#flushLevel) {
      this.flush()
    }
  }

  /** Flushes through the destination's normal write path. */
  flush(): void {
    this.#drain(false)
  }

  /** Flushes through a numeric descriptor when one is available. */
  flushSync(): void {
    this.#drain(true)
  }

  /** Releases the timer and synchronously drains pending lines. */
  close(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer)
      this.#timer = undefined
    }

    this.flushSync()
  }

  #drain(synchronous: boolean): void {
    if (this.#bytes === 0) {
      return
    }

    const chunk = this.#buffer
    const records = this.#records

    this.#buffer = ''
    this.#bytes = 0
    this.#records = 0

    try {
      if (synchronous) {
        this.#destination.writeSync(chunk)
      } else {
        this.#destination.write(chunk)
      }
    } catch (error) {
      this.#monitor.record(error, synchronous ? 'flushSync' : 'flush', chunk, records)
    }
  }
}

export { BufferedWriter }
