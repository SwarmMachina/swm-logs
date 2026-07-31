import type { LogTransport } from '@swarmmachina/swm-log'

/** Minimal non-blocking acceptor used to isolate fire-and-forget fan-out overhead. */
export class AcceptTransport implements LogTransport {
  #checksum = 0

  write(line: string, level: number): void {
    this.#checksum = (this.#checksum + line.length + level) | 0
  }

  flushSync(): void {
    if (this.#checksum === Number.POSITIVE_INFINITY) {
      throw new Error('unreachable checksum')
    }
  }
}
