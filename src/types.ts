import type { BuiltInLevelName } from './constants.js'

/** A writable destination accepted by {@link LoggerOptions.destination}. */
export interface LogDestination {
  /** Optional numeric descriptor used by {@link Logger.flushSync}. */
  readonly fd?: number

  /**
   * Writes one or more complete NDJSON records.
   *
   * The logger deliberately ignores the return value. A Node.js stream may
   * return `false` and retain the chunk in its own bounded/unbounded queue.
   */
  write(chunk: string): unknown
}

/** Operation that failed while delivering formatted log data. */
export type DestinationOperation = 'write' | 'flush' | 'flushSync' | 'close'

/** Immutable notification emitted for a contained destination failure. */
export interface DestinationErrorEvent {
  /** Original thrown value. */
  readonly error: unknown

  /** Delivery operation that failed. */
  readonly operation: DestinationOperation

  /** UTF-8 bytes that may not have reached the destination. */
  readonly droppedBytes: number

  /** Complete chunks that may not have reached the destination. */
  readonly droppedChunks: number

  /** Complete records represented by the failed chunk. */
  readonly droppedRecords: number
}

/** Snapshot of failures observed by a root logger and all of its children. */
export interface DeliveryStats {
  readonly destinationErrors: number
  readonly droppedBytes: number
  readonly droppedChunks: number
  readonly droppedRecords: number
}

/** Synchronous observer for contained destination failures. */
export type DestinationErrorHandler = (event: DestinationErrorEvent) => void

/** One structured record passed through the opt-in extension pipeline. */
export interface LogRecord {
  /** Numeric severity written to the default `level` field. */
  readonly level: number

  /** Configured name for {@link LogRecord.level}, or its decimal representation. */
  readonly levelLabel: string

  /** Epoch time in milliseconds. */
  readonly time: number

  /** Formatted message, when the log call supplied one. */
  message?: string

  /** Effective root/child bindings merged with call fields. */
  fields: LogFields
}

/** Synchronous structured hook executed after redaction/serializers and before formatting. */
export type BeforeFormatHook = (record: LogRecord) => false | void

/** Synchronous string hook executed after formatting and before delivery. */
export type AfterFormatHook = (line: string, record: Readonly<LogRecord>) => false | string | void

/** Opt-in hooks compiled once when a logger is constructed. */
export interface LoggerHooks {
  /** Mutates an owned per-call record or returns `false` to drop it. */
  beforeFormat?: BeforeFormatHook | readonly BeforeFormatHook[]

  /** Replaces a formatted line, observes it, or returns `false` to drop it. */
  afterFormat?: AfterFormatHook | readonly AfterFormatHook[]
}

/** Encodes one structured record. The logger adds a trailing line feed when absent. */
export type LogFormatter = (record: Readonly<LogRecord>) => string

/** Transforms one top-level field before JSON or custom formatting. */
export type LogSerializer = (value: unknown) => unknown

/** Keyed top-level serializers compiled once during construction. */
export type LogSerializers = Readonly<Record<string, LogSerializer>>

/** Computes a replacement for one matched redact path. */
export type RedactCensor = (value: unknown, path: readonly string[]) => unknown

/** Rich redact configuration with wildcard/bracket paths and removal support. */
export interface RedactOptions {
  /** Dot/bracket paths; `*` and `[*]` match every key at one level. */
  paths: readonly string[]

  /** Static or computed replacement. Defaults to `[Redacted]`. */
  censor?: string | RedactCensor

  /** Removes matched keys instead of replacing their values. */
  remove?: boolean
}

/**
 * Lifecycle-aware delivery port for external transports.
 *
 * Implement this contract as a class when the transport owns a worker, socket,
 * file, queue, or another resource. Transport calls are contained and never
 * escape a log method.
 */
export interface LogTransport {
  /**
   * Accepts one complete formatted record and its numeric severity.
   *
   * This is a fire-and-forget boundary. Implementations must return quickly
   * after accepting the record into their own queue. They own batching,
   * backpressure, retry, persistence, and asynchronous failure reporting.
   */
  write(line: string, level: number): void

  /** Flushes transport-owned asynchronous or userspace buffers. */
  flush?(): void | Promise<void>

  /** Synchronously flushes transport-owned buffers when supported. */
  flushSync?(): void

  /** Flushes and releases transport-owned resources. */
  close?(): void | Promise<void>
}

/** Configuration for opt-in batching. */
export interface BufferingOptions {
  /**
   * Flush threshold in UTF-8 bytes.
   * @default `65_536` (64 KiB).
   */
  maxBytes?: number

  /**
   * Periodic flush interval in milliseconds; `0` disables the timer.
   * @default `1_000`.
   */
  flushInterval?: number

  /**
   * Level that forces an immediate flush.
   * @default `'warn'`.
   */
  flushLevel?: Level
}

/** User-defined numeric level map. */
export type CustomLevels = Readonly<Record<string, number>>

/** A built-in/custom name, a numeric severity, or the filtering sentinel. */
export type Level = BuiltInLevelName | 'silent' | (string & {}) | number

/** Structured fields accepted by every log method. */
export type LogFields = Record<string, unknown>

/** Arguments accepted by built-in and custom log methods. */
export type LogArguments =
  | []
  | [message: unknown, ...values: unknown[]]
  | [fields: LogFields, message?: unknown, ...values: unknown[]]
  | [error: Error, message?: unknown, ...values: unknown[]]

/** Logger construction options. Invalid values throw synchronously. */
export interface LoggerOptions<TCustomLevels extends CustomLevels = CustomLevels> {
  /**
   * Minimum enabled severity.
   * @default `'info'`.
   */
  level?: Extract<keyof TCustomLevels, string> | Level

  /** Custom numeric levels accepted by {@link Logger.log}. */
  customLevels?: TCustomLevels

  /** Root bindings serialized once during construction. */
  bindings?: LogFields

  /** Exact/wildcard paths, or rich censor/removal configuration. */
  redact?: readonly string[] | RedactOptions

  /** Top-level serializers keyed by field or binding name. */
  serializers?: LogSerializers

  /**
   * Immediate console output by default, or bounded opt-in batching.
   * @default `false`.
   */
  buffering?: boolean | BufferingOptions

  /**
   * Writes records to the configured destination in addition to transports.
   * Set to `false` for transport-only delivery.
   * @default `true`.
   */
  console?: boolean

  /**
   * Output target.
   * @default `'stdout'`.
   */
  destination?: 'stdout' | 'stderr' | number | LogDestination

  /** Fire-and-forget transports that independently own delivery policy and state. */
  transports?: readonly LogTransport[]

  /** Synchronous hooks enabled only for this logger and its children. */
  hooks?: LoggerHooks

  /**
   * Custom record encoder for pretty or alternate output.
   *
   * Omit this option to keep the built-in deterministic JSON encoder.
   */
  formatter?: LogFormatter

  /** Receives contained destination failures; handler failures are also contained. */
  onDestinationError?: DestinationErrorHandler

  /**
   * Epoch-millisecond clock, primarily useful for deterministic tests.
   * @default `Date.now`.
   */
  time?: () => number

  /**
   * Maximum number of Error objects retained from a cause chain.
   * @default `5`.
   */
  errorCauseDepth?: number

  /**
   * Maximum nested object/array depth retained by safe serialization.
   * @default `5`.
   */
  depthLimit?: number

  /**
   * Maximum own properties/array elements retained per container.
   * @default `100`.
   */
  edgeLimit?: number
}

/** Child-specific options. */
export interface ChildLoggerOptions<TCustomLevels extends CustomLevels = CustomLevels> {
  /** Child filtering threshold; output and serializers remain shared. */
  level?: Extract<keyof TCustomLevels, string> | Level
}
