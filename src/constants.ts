/** Pino-compatible built-in level values. */
const LEVELS = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
} as const)

type BuiltInLevelName = keyof typeof LEVELS

const DEFAULT_ERROR_CAUSE_DEPTH = 5
const DEFAULT_DEPTH_LIMIT = 5
const DEFAULT_EDGE_LIMIT = 100
const DEFAULT_BUFFER_BYTES = 64 * 1024
const DEFAULT_FLUSH_INTERVAL = 1_000

export {
  DEFAULT_BUFFER_BYTES,
  DEFAULT_DEPTH_LIMIT,
  DEFAULT_EDGE_LIMIT,
  DEFAULT_ERROR_CAUSE_DEPTH,
  DEFAULT_FLUSH_INTERVAL,
  LEVELS
}
export type { BuiltInLevelName }
