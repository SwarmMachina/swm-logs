import { DEFAULT_DEPTH_LIMIT, DEFAULT_EDGE_LIMIT, DEFAULT_ERROR_CAUSE_DEPTH, LEVELS } from './constants.js'
import { ExtensionPipeline } from './extensions/extension-pipeline.js'
import { LevelRegistry } from './level-registry.js'
import { parseLogArguments } from './log-argument-parser.js'
import { OutputPipeline } from './output/output-pipeline.js'
import { FieldSerializer } from './serialization/field-serializer.js'
import { quoteString } from './serialization/quote-string.js'
import type { SafeStringifyOptions } from './serialization/safe-stringify.js'
import type {
  ChildLoggerOptions,
  CustomLevels,
  DeliveryStats,
  LogArguments,
  LogFields,
  LoggerOptions,
  LogRecord
} from './types.js'

interface LoggerState {
  bindingValues: LogFields
  bindingSnapshot: LogFields | null
  bindingsPrefix: string
  clock: () => number
  extensionPipeline: ExtensionPipeline | null
  fieldSerializer: FieldSerializer
  levelLabel: string | number
  levelRegistry: LevelRegistry
  output: OutputPipeline
  stringifyOptions: SafeStringifyOptions
  threshold: number
}

interface InternalOptions {
  [INTERNAL_STATE]: LoggerState
}

const INTERNAL_STATE: unique symbol = Symbol('LoggerState')

/**
 * A zero-dependency structured NDJSON logger.
 *
 * Child instances pre-serialize their bindings and share the root writer. Log
 * methods contain serialization and destination errors; invalid construction
 * and child configuration throw `TypeError` synchronously.
 * @template TCustomLevels - Compile-time map for configured custom levels.
 */
export class Logger<const TCustomLevels extends CustomLevels = Record<never, never>> {
  #bindingValues!: LogFields
  #bindingSnapshot!: LogFields | null
  #bindingsPrefix!: string
  #clock!: () => number
  #extensionPipeline!: ExtensionPipeline | null
  #fieldSerializer!: FieldSerializer
  #levelLabel!: string | number
  #levelRegistry!: LevelRegistry
  #output!: OutputPipeline
  #stringifyOptions!: SafeStringifyOptions
  #threshold!: number

  /**
   * Creates a logger and validates all configuration.
   * @throws {TypeError} If an option is malformed or bindings cannot be serialized.
   */
  constructor(options: LoggerOptions<TCustomLevels> = {}) {
    const internalState = (options as LoggerOptions<TCustomLevels> & Partial<InternalOptions>)[INTERNAL_STATE]

    if (internalState !== undefined) {
      this.#initializeChild(internalState)

      return
    }

    assertRecord(options as unknown, 'options')

    this.#levelRegistry = new LevelRegistry(options.customLevels)
    const errorCauseDepth = positiveInteger(options.errorCauseDepth, DEFAULT_ERROR_CAUSE_DEPTH, 'errorCauseDepth')
    const depthLimit = positiveInteger(options.depthLimit, DEFAULT_DEPTH_LIMIT, 'depthLimit')
    const edgeLimit = positiveInteger(options.edgeLimit, DEFAULT_EDGE_LIMIT, 'edgeLimit')

    this.#stringifyOptions = Object.freeze({ depthLimit, edgeLimit })
    this.#fieldSerializer = new FieldSerializer({
      depthLimit,
      edgeLimit,
      errorCauseDepth,
      redact: options.redact,
      serializers: options.serializers
    })
    this.#clock = normalizeClock(options.time)
    this.#bindingValues = normalizeBindings(options.bindings, 'options.bindings')
    this.#bindingsPrefix = this.#serializeBindings(this.#bindingValues, 'bindings')
    const extensionsEnabled = options.formatter !== undefined || options.hooks !== undefined

    this.#bindingSnapshot = extensionsEnabled ? parseBindingsPrefix(this.#bindingsPrefix) : null
    this.#extensionPipeline = extensionsEnabled
      ? new ExtensionPipeline({
          depthLimit,
          edgeLimit,
          errorCauseDepth,
          formatter: options.formatter,
          hooks: options.hooks
        })
      : null
    const selected = this.#levelRegistry.resolve(options.level ?? 'info', 'options.level')

    this.#threshold = selected.value
    this.#levelLabel = selected.label
    this.#output = new OutputPipeline(options, this.#levelRegistry)
  }

  /** Current filtering threshold name or numeric value. */
  get level(): string | number {
    return this.#levelLabel
  }

  /**
   * Changes the filtering threshold without rebuilding the logger.
   * @throws {TypeError} If the level is not configured.
   */
  set level(value: Extract<keyof TCustomLevels, string> | string | number) {
    const selected = this.#levelRegistry.resolve(value, 'level')

    this.#threshold = selected.value
    this.#levelLabel = selected.label
  }

  /** Logs at severity `10`. */
  trace(...args: LogArguments): void {
    this.#write(LEVELS.trace, args)
  }

  /** Logs at severity `20`. */
  debug(...args: LogArguments): void {
    this.#write(LEVELS.debug, args)
  }

  /** Logs at severity `30`. */
  info(...args: LogArguments): void {
    this.#write(LEVELS.info, args)
  }

  /** Logs at severity `40` and flushes the default buffered writer. */
  warn(...args: LogArguments): void {
    this.#write(LEVELS.warn, args)
  }

  /** Logs at severity `50`. An `Error` first argument uses the `err` serializer. */
  error(...args: LogArguments): void {
    this.#write(LEVELS.error, args)
  }

  /** Logs at severity `60`. This method does not terminate the process. */
  fatal(...args: LogArguments): void {
    this.#write(LEVELS.fatal, args)
  }

  /**
   * Logs at a configured name or numeric severity.
   *
   * Invalid dynamic levels become a `logger_error` record instead of escaping
   * the log call.
   */
  log(level: Extract<keyof TCustomLevels, string> | string | number, ...args: LogArguments): void {
    try {
      this.#write(this.#levelRegistry.resolve(level, 'level').value, args)
    } catch (error) {
      this.#writeFallback(LEVELS.error, error)
    }
  }

  /**
   * Creates a child sharing the output writer and pre-serializes new bindings.
   * @throws {TypeError} If bindings or child options are invalid.
   */
  child(bindings: LogFields, options: ChildLoggerOptions<TCustomLevels> = {}): Logger<TCustomLevels> {
    const childBindings = normalizeBindings(bindings, 'child bindings')

    assertRecord(options, 'child options')

    const suffix = this.#serializeBindings(childBindings, 'child bindings')
    const selected =
      options.level === undefined
        ? { label: this.#levelLabel, value: this.#threshold }
        : this.#levelRegistry.resolve(options.level, 'child options.level')
    const internal: InternalOptions = {
      [INTERNAL_STATE]: {
        bindingValues: { ...this.#bindingValues, ...childBindings },
        bindingSnapshot:
          this.#extensionPipeline === null ? null : { ...this.#bindingSnapshot!, ...parseBindingsPrefix(suffix) },
        bindingsPrefix: this.#bindingsPrefix + suffix,
        clock: this.#clock,
        extensionPipeline: this.#extensionPipeline,
        fieldSerializer: this.#fieldSerializer,
        levelLabel: selected.label,
        levelRegistry: this.#levelRegistry,
        output: this.#output,
        stringifyOptions: this.#stringifyOptions,
        threshold: selected.value
      }
    }

    return new Logger<TCustomLevels>(internal as unknown as LoggerOptions<TCustomLevels>)
  }

  /** Returns a shallow copy of the effective root and child bindings. */
  bindings(): LogFields {
    return { ...this.#bindingValues }
  }

  /** Returns shared delivery-failure counters for this root/child logger tree. */
  deliveryStats(): DeliveryStats {
    return this.#output.deliveryStats()
  }

  /** Returns whether a configured level passes the current threshold. */
  isLevelEnabled(level: Extract<keyof TCustomLevels, string> | string | number): boolean {
    try {
      return this.#levelRegistry.resolve(level, 'level').value >= this.#threshold
    } catch {
      return false
    }
  }

  /** Flushes opt-in buffered output through the destination's normal write path. */
  flush(): void | Promise<void> {
    return this.#output.flush()
  }

  /**
   * Flushes opt-in buffered output synchronously when the destination exposes a descriptor.
   *
   * Call this from process exit hooks and fatal exception handlers.
   */
  flushSync(): void {
    this.#output.flushSync()
  }

  /** Flushes and releases the timer shared with all child loggers. */
  close(): void | Promise<void> {
    return this.#output.close()
  }

  #initializeChild(state: LoggerState): void {
    this.#bindingValues = state.bindingValues
    this.#bindingSnapshot = state.bindingSnapshot
    this.#bindingsPrefix = state.bindingsPrefix
    this.#clock = state.clock
    this.#extensionPipeline = state.extensionPipeline
    this.#fieldSerializer = state.fieldSerializer
    this.#levelLabel = state.levelLabel
    this.#levelRegistry = state.levelRegistry
    this.#output = state.output
    this.#stringifyOptions = state.stringifyOptions
    this.#threshold = state.threshold
  }

  #serializeBindings(bindings: LogFields, label: string): string {
    try {
      return this.#fieldSerializer.serialize(bindings)
    } catch (error) {
      throw new TypeError(`${label} could not be serialized: ${errorMessage(error)}`, { cause: error })
    }
  }

  #write(level: number, args: LogArguments): void {
    if (level < this.#threshold) {
      return
    }

    try {
      const time = this.#clock()

      if (!Number.isFinite(time)) {
        throw new TypeError('time function must return a finite number')
      }

      const timestamp = Math.trunc(time)
      const { fields, message } = parseLogArguments(args, this.#stringifyOptions)

      if (this.#extensionPipeline !== null) {
        this.#writeExtended(level, timestamp, fields, message)

        return
      }

      const messageFragment = message === undefined ? '' : `,"msg":${quoteString(message)}`
      const fieldsFragment = fields === null ? '' : this.#fieldSerializer.serialize(fields)
      const line = `{"level":${level},"time":${timestamp}${messageFragment}${this.#bindingsPrefix}${fieldsFragment}}\n`

      this.#output.write(line, level)
    } catch (error) {
      this.#writeFallback(level, error)
    }
  }

  #writeExtended(level: number, time: number, fields: LogFields | null, message: string | undefined): void {
    const record: LogRecord = {
      fields: this.#prepareExtensionFields(fields),
      level,
      levelLabel: String(this.#levelRegistry.labelFor(level) ?? level),
      message,
      time
    }
    const line = this.#extensionPipeline!.process(record)

    if (line !== null) {
      this.#output.write(line, level)
    }
  }

  #prepareExtensionFields(fields: LogFields | null): LogFields {
    const prepared: LogFields = { ...this.#bindingSnapshot! }

    if (fields === null) {
      return prepared
    }

    this.#fieldSerializer.assignPreparedFields(fields, prepared)

    return prepared
  }

  #writeFallback(level: number, error: unknown): void {
    const line = `{"level":${level},"time":${Date.now()},"logger_error":${quoteString(errorMessage(error))}}\n`

    this.#output.write(line, level)
  }
}

function parseBindingsPrefix(prefix: string): LogFields {
  return prefix.length === 0 ? {} : (JSON.parse(`{${prefix.slice(1)}}`) as LogFields)
}

function errorMessage(value: unknown): string {
  try {
    if (value instanceof Error) {
      return value.message
    }

    return String(value)
  } catch {
    return 'unknown logger failure'
  }
}

function normalizeClock(configuredClock: (() => number) | undefined): () => number {
  const clock = configuredClock ?? Date.now

  if (typeof clock !== 'function') {
    throw new TypeError('options.time must be a function returning epoch milliseconds')
  }

  return clock
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
}

function normalizeBindings(value: LogFields | undefined, label: string): LogFields {
  if (value === undefined) {
    return {}
  }

  assertRecord(value, label)

  return value
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`)
  }

  return value
}
