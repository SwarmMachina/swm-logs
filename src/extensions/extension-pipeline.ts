import type { AfterFormatHook, BeforeFormatHook, LogFields, LogFormatter, LoggerHooks, LogRecord } from '../types.js'
import { assertFunction, assertRecord, isFunction, isRecord } from '../validation.js'
import { FieldSerializer } from '../serialization/field-serializer.js'
import { quoteString } from '../serialization/quote-string.js'

interface ExtensionPipelineOptions {
  depthLimit: number
  edgeLimit: number
  errorCauseDepth: number
  formatter?: LogFormatter
  hooks?: LoggerHooks
}

const EMPTY_HOOKS: readonly never[] = Object.freeze([])

function normalizeHooks<THook>(value: THook | readonly THook[] | undefined, label: string): readonly THook[] {
  if (value === undefined) {
    return EMPTY_HOOKS
  }

  const hooks = Array.isArray(value) ? [...value] : [value]

  if (hooks.some((hook) => !isFunction(hook))) {
    throw new TypeError(`options.${label} must be a function or an array of functions`)
  }

  return Object.freeze(hooks) as readonly THook[]
}

function assertFields(value: unknown): asserts value is LogFields {
  if (!isRecord(value)) {
    throw new TypeError('record.fields must remain an object')
  }
}

/** Owns the immutable, opt-in hook and formatting pipeline. */
class ExtensionPipeline {
  readonly #afterFormat: readonly AfterFormatHook[]
  readonly #beforeFormat: readonly BeforeFormatHook[]
  readonly #fieldSerializer: FieldSerializer
  readonly #formatter: LogFormatter | null

  /** Compiles and validates extension callbacks once, outside the hot path. */
  constructor(options: ExtensionPipelineOptions) {
    if (options.hooks !== undefined) {
      assertRecord(options.hooks, 'options.hooks')
    }

    if (options.formatter !== undefined) {
      assertFunction(options.formatter, 'options.formatter')
    }

    this.#beforeFormat = normalizeHooks(options.hooks?.beforeFormat, 'hooks.beforeFormat')
    this.#afterFormat = normalizeHooks(options.hooks?.afterFormat, 'hooks.afterFormat')
    this.#formatter = options.formatter ?? null
    this.#fieldSerializer = new FieldSerializer({
      depthLimit: options.depthLimit,
      edgeLimit: options.edgeLimit,
      errorCauseDepth: options.errorCauseDepth
    })
  }

  /** Runs one prepared owned record through structured hooks, formatting, and line hooks. */
  process(record: LogRecord): string | null {
    for (const hook of this.#beforeFormat) {
      const result = hook(record)

      if (result === false) {
        return null
      }

      if (result !== undefined) {
        throw new TypeError('beforeFormat hooks must return false or undefined')
      }
    }

    assertFields(record.fields)

    let line = this.#formatter === null ? this.#formatJson(record) : this.#formatter(record)

    if (typeof line !== 'string') {
      throw new TypeError('formatter must return a string')
    }

    for (const hook of this.#afterFormat) {
      const result = hook(line, record)

      if (result === false) {
        return null
      }

      if (typeof result === 'string') {
        line = result
      } else if (result !== undefined) {
        throw new TypeError('afterFormat hooks must return false, a string, or undefined')
      }
    }

    return line.endsWith('\n') ? line : `${line}\n`
  }

  #formatJson(record: Readonly<LogRecord>): string {
    const message = record.message === undefined ? '' : `,"msg":${quoteString(record.message)}`
    const fields = this.#fieldSerializer.serialize(record.fields)

    return `{"level":${record.level},"time":${Math.trunc(record.time)}${message}${fields}}`
  }
}

export { ExtensionPipeline }
