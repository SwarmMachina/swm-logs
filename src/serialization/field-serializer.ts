import type { LogSerializers, RedactOptions } from '../types.js'
import { quoteString } from './quote-string.js'
import { REDACT_NOT_APPLICABLE, Redactor } from './redact.js'
import { normalizeError, safeStringify, safeStringifyError, type SafeStringifyOptions } from './safe-stringify.js'

interface FieldSerializerOptions {
  depthLimit: number
  edgeLimit: number
  errorCauseDepth: number
  redact?: readonly string[] | RedactOptions
  serializers?: LogSerializers
}

interface CompiledFieldSerializerOptions {
  depthLimit: number
  edgeLimit: number
  errorCauseDepth: number
  redactor: Redactor | null
  serializers: LogSerializers | null
}

const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty) as (value: object, property: PropertyKey) => boolean

/** Owns the immutable configuration for top-level field serialization. */
export class FieldSerializer {
  readonly #options: CompiledFieldSerializerOptions

  constructor(options: FieldSerializerOptions) {
    this.#options = {
      depthLimit: options.depthLimit,
      edgeLimit: options.edgeLimit,
      errorCauseDepth: options.errorCauseDepth,
      redactor: options.redact === undefined ? null : new Redactor(options.redact),
      serializers: compileSerializers(options.serializers)
    }
  }

  /** Serializes own fields as comma-prefixed JSON members. */
  serialize(fields: Record<string, unknown>): string {
    const options = this.#options

    if (
      options.serializers === null &&
      options.redactor?.supportsFusedSerialization === true &&
      !(fields.err instanceof Error)
    ) {
      return serializeFieldsWithRedaction(fields, options)
    }

    const source = (options.redactor === null ? fields : options.redactor.redact(fields)) as Record<string, unknown>

    return options.serializers === null
      ? serializeFields(source, options)
      : serializeFieldsWithSerializers(source, options)
  }

  /** Redacts and serializes own fields into a logger-owned extension record. */
  assignPreparedFields(fields: Record<string, unknown>, target: Record<string, unknown>): void {
    const options = this.#options
    const source = (options.redactor === null ? fields : options.redactor.redact(fields)) as Record<string, unknown>

    for (const key of Object.keys(source)) {
      if (isReservedLogKey(key)) {
        continue
      }

      const value = source[key]
      const prepared =
        options.serializers !== null && hasOwn(options.serializers, key)
          ? options.serializers[key]!(value)
          : key === 'err' && value instanceof Error
            ? normalizeError(value, options.errorCauseDepth, options)
            : value

      defineField(target, key, prepared)
    }
  }
}

function serializeFieldsWithRedaction(
  source: Record<string, unknown>,
  options: CompiledFieldSerializerOptions
): string {
  const redactor = options.redactor!

  let output = ''

  for (const key of Object.keys(source)) {
    if (isReservedLogKey(key)) {
      continue
    }

    const value = source[key]
    const redacted = redactor.serializeField(key, value, options)
    const serialized = redacted === REDACT_NOT_APPLICABLE ? serializeValue(value, options) : redacted

    if (serialized !== undefined) {
      output += `,${quoteString(key)}:${serialized}`
    }
  }

  return output
}

function serializeFields(source: Record<string, unknown>, options: CompiledFieldSerializerOptions): string {
  let output = ''

  for (const key of Object.keys(source)) {
    if (isReservedLogKey(key)) {
      continue
    }

    const value = source[key]
    const serialized =
      key === 'err' && value instanceof Error
        ? safeStringifyError(value, options.errorCauseDepth, options)
        : serializeValue(value, options)

    if (serialized !== undefined) {
      output += `,${quoteString(key)}:${serialized}`
    }
  }

  return output
}

function serializeFieldsWithSerializers(
  source: Record<string, unknown>,
  options: CompiledFieldSerializerOptions
): string {
  const serializers = options.serializers!

  let output = ''

  for (const key of Object.keys(source)) {
    if (isReservedLogKey(key)) {
      continue
    }

    const value = source[key]
    const serialized = hasOwn(serializers, key)
      ? serializeValue(serializers[key]!(value), options)
      : key === 'err' && value instanceof Error
        ? safeStringifyError(value, options.errorCauseDepth, options)
        : serializeValue(value, options)

    if (serialized !== undefined) {
      output += `,${quoteString(key)}:${serialized}`
    }
  }

  return output
}

function compileSerializers(serializers: LogSerializers | undefined): LogSerializers | null {
  if (serializers === undefined) {
    return null
  }

  if (serializers === null || typeof serializers !== 'object' || Array.isArray(serializers)) {
    throw new TypeError('options.serializers must be an object of functions')
  }

  const compiled: Record<string, (value: unknown) => unknown> = Object.create(null)

  for (const [key, serializer] of Object.entries(serializers)) {
    if (isReservedLogKey(key)) {
      throw new TypeError(`serializer key "${key}" is reserved by the log envelope`)
    }

    if (typeof serializer !== 'function') {
      throw new TypeError(`serializer "${key}" must be a function`)
    }

    compiled[key] = serializer
  }

  return Object.freeze(compiled)
}

function isReservedLogKey(key: string): boolean {
  return key === 'level' || key === 'time' || key === 'msg'
}

function defineField(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    })
  } else {
    target[key] = value
  }
}

/** Returns one JSON value, or `undefined` when JSON omits it. */
export function serializeValue(value: unknown, options: SafeStringifyOptions): string | undefined {
  if (value === null) {
    return 'null'
  }

  switch (typeof value) {
    case 'string':
      return quoteString(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      return Number.isFinite(value) ? String(Object.is(value, -0) ? 0 : value) : 'null'
    case 'bigint':
      return quoteString(String(value))
    case 'object':
      return safeStringify(value, options)
    default:
      return undefined
  }
}
