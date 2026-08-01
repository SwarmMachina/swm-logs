import type { DeliveryStats, DestinationErrorEvent, DestinationErrorHandler, DestinationOperation } from '../types.js'
import { assertOptionalFunction } from '../validation.js'

/** Owns shared delivery-failure counters and a reentrancy-safe observer. */
class DeliveryMonitor {
  #destinationErrors = 0
  #droppedBytes = 0
  #droppedChunks = 0
  #droppedRecords = 0
  readonly #handler: DestinationErrorHandler | null
  #reporting = false

  /** Validates and installs an optional synchronous failure observer. */
  constructor(handler: DestinationErrorHandler | undefined) {
    assertOptionalFunction(handler, 'options.onDestinationError')

    this.#handler = handler ?? null
  }

  /** Records one contained failure and notifies the observer at most once recursively. */
  record(error: unknown, operation: DestinationOperation, chunk = '', records = 0): void {
    const droppedChunks = chunk.length === 0 ? 0 : 1
    const droppedBytes = chunk.length === 0 ? 0 : Buffer.byteLength(chunk)

    this.#destinationErrors += 1
    this.#droppedBytes += droppedBytes
    this.#droppedChunks += droppedChunks
    this.#droppedRecords += records

    if (this.#handler === null || this.#reporting) {
      return
    }

    const event: DestinationErrorEvent = Object.freeze({
      droppedBytes,
      droppedChunks,
      droppedRecords: records,
      error,
      operation
    })

    this.#reporting = true

    try {
      this.#handler(event)
    } catch {
      // Failure reporting must not become a new application failure path.
    } finally {
      this.#reporting = false
    }
  }

  /** Returns a detached immutable counter snapshot. */
  snapshot(): DeliveryStats {
    return Object.freeze({
      destinationErrors: this.#destinationErrors,
      droppedBytes: this.#droppedBytes,
      droppedChunks: this.#droppedChunks,
      droppedRecords: this.#droppedRecords
    })
  }
}

export { DeliveryMonitor }
