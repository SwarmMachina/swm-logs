/** Pino-compatible built-in level values. */
export const LEVELS = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
} as const)

export type BuiltInLevelName = keyof typeof LEVELS

export const DEFAULT_ERROR_CAUSE_DEPTH = 5
export const DEFAULT_DEPTH_LIMIT = 5
export const DEFAULT_EDGE_LIMIT = 100
export const DEFAULT_BUFFER_BYTES = 64 * 1024
export const DEFAULT_FLUSH_INTERVAL = 1_000
