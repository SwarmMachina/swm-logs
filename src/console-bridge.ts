import type { Logger } from './logger.js'
import type { CustomLevels, LogArguments } from './types.js'
import { isFunction, isObject } from './validation.js'

type ConsoleMethod = 'trace' | 'debug' | 'log' | 'info' | 'warn' | 'error'
type LoggerMethod = Exclude<ConsoleMethod, 'log'>
type ConsoleLike = Record<ConsoleMethod, (...data: unknown[]) => void>
type ConsolePatch = readonly [original: (...data: unknown[]) => void, installed: (...data: unknown[]) => void]

const METHOD_LEVELS = [
  ['trace', 'trace'],
  ['debug', 'debug'],
  ['log', 'info'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error']
] as const satisfies readonly (readonly [ConsoleMethod, LoggerMethod])[]

/** Owns an opt-in console patch and the exact methods needed to restore it. */
class ConsoleBridge {
  readonly #console: ConsoleLike
  #installed = false
  readonly #logger: Logger<CustomLevels>
  readonly #patches = new Map<ConsoleMethod, ConsolePatch>()

  /**
   * Creates an uninstalled bridge.
   * @throws {TypeError} If `logger` does not expose the required level methods.
   */
  constructor(logger: Logger<CustomLevels>, targetConsole: Console = console) {
    if (!isObject(logger)) {
      throw new TypeError('ConsoleBridge logger must be a Logger-compatible object')
    }

    for (const [, level] of METHOD_LEVELS) {
      if (!isFunction(logger[level])) {
        throw new TypeError(`ConsoleBridge logger is missing ${level}()`)
      }
    }

    this.#logger = logger
    this.#console = targetConsole as unknown as ConsoleLike
  }

  /** Installs the patch once and returns this lifecycle owner. */
  install(): this {
    if (this.#installed) {
      return this
    }

    for (const [method, level] of METHOD_LEVELS) {
      const patch = (...args: unknown[]) => this.#logger[level](...(args as LogArguments))

      this.#patches.set(method, [this.#console[method], patch])
      this.#console[method] = patch
    }

    this.#installed = true

    return this
  }

  /** Restores methods that still point at this bridge's patches. */
  restore(): void {
    if (!this.#installed) {
      return
    }

    for (const [method, [original, patch]] of this.#patches) {
      if (this.#console[method] === patch) {
        this.#console[method] = original
      }
    }

    this.#patches.clear()
    this.#installed = false
  }
}

export { ConsoleBridge }
