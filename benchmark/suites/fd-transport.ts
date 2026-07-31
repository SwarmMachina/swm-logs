import { writeSync } from 'node:fs'

import type { LogTransport } from '@swarmmachina/swm-log'

/** Minimal external transport used to isolate the transport-port overhead. */
export class FdTransport implements LogTransport {
  readonly #fd: number

  constructor(fd: number) {
    this.#fd = fd
  }

  write(line: string, _level: number): void {
    writeSync(this.#fd, line)
  }

  flushSync(): void {}
}
