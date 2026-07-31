import type { LogSerializers, RedactOptions } from '../types.js'
import { assignOwnValue, hasOwn } from './own-property.js'
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
    const useFusedRedaction =
      options.serializers === null &&
      options.redactor?.supportsFusedSerialization === true &&
      !(fields.err instanceof Error)
    const source = useFusedRedaction
      ? fields
      : ((options.redactor === null ? fields : options.redactor.redact(fields)) as Record<string, unknown>)

    let output = ''

    for (const key of Object.keys(source)) {
      if (isReservedLogKey(key)) {
        continue
      }

      const value = source[key]
      const redacted = useFusedRedaction ? options.redactor!.serializeField(key, value, options) : REDACT_NOT_APPLICABLE
      const serialized = redacted === REDACT_NOT_APPLICABLE ? serializeField(key, value, options) : redacted

      if (serialized !== undefined) {
        output += `,${quoteString(key)}:${serialized}`
      }
    }

    return output
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

      assignOwnValue(target, key, prepared)
    }
  }
}

function serializeField(key: string, value: unknown, options: CompiledFieldSerializerOptions): string | undefined {
  if (options.serializers !== null && hasOwn(options.serializers, key)) {
    return serializeValue(options.serializers[key]!(value), options)
  }

  return key === 'err' && value instanceof Error
    ? safeStringifyError(value, options.errorCauseDepth, options)
    : serializeValue(value, options)
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
