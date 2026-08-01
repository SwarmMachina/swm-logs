import type { LoggerOptions } from '../../dist/index.js'

/** Crosses the type boundary intentionally to exercise runtime validation. */
function invalidLoggerOptions(options: unknown): LoggerOptions {
  return options as LoggerOptions
}

export { invalidLoggerOptions }
