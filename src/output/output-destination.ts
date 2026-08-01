import { writeSync } from 'node:fs'

import type { LogDestination } from '../types.js'
import { asNonNegativeInteger, isFunction, isNonNegativeInteger, isObject } from '../validation.js'

type DestinationOption = 'stdout' | 'stderr' | number | LogDestination | undefined

/** Owns and normalizes the configured stdout, stderr, descriptor, or writer. */
class OutputDestination {
  readonly #fd: number | undefined
  readonly #target: LogDestination | null

  /**
   * Creates an output owner.
   * @throws {TypeError} If `target` is not a supported destination.
   */
  constructor(target: DestinationOption) {
    if (target === undefined || target === 'stdout') {
      this.#target = process.stdout
      this.#fd = asNonNegativeInteger(process.stdout.fd)

      return
    }

    if (target === 'stderr') {
      this.#target = process.stderr
      this.#fd = asNonNegativeInteger(process.stderr.fd)

      return
    }

    if (isNonNegativeInteger(target)) {
      this.#fd = target
      this.#target = null

      return
    }

    if (isObject(target) && isFunction(target.write)) {
      this.#target = target
      this.#fd = asNonNegativeInteger(target.fd)

      return
    }

    throw new TypeError('options.destination must be stdout, stderr, a file descriptor, or an object with write()')
  }

  /** Writes a chunk through the target's normal path. */
  write(chunk: string): void {
    if (this.#target === null) {
      this.#writeFd(chunk)

      return
    }

    this.#target!.write(chunk)
  }

  /** Writes a chunk synchronously when a numeric descriptor is available. */
  writeSync(chunk: string): void {
    if (this.#fd !== undefined) {
      this.#writeFd(chunk)

      return
    }

    this.#target!.write(chunk)
  }

  #writeFd(chunk: string): void {
    const buffer = Buffer.from(chunk)

    let offset = 0

    while (offset < buffer.length) {
      const written = writeSync(this.#fd!, buffer, offset, buffer.length - offset)

      if (written === 0) {
        throw new Error('destination made no write progress')
      }

      offset += written
    }
  }
}

export { OutputDestination }
