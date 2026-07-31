import { DEFAULT_DEPTH_LIMIT, DEFAULT_EDGE_LIMIT } from '../constants.js'
import { quoteString } from './quote-string.js'

/** Bounds applied while converting nested values into JSON-safe values. */
export interface SafeStringifyOptions {
  depthLimit?: number
  edgeLimit?: number
}

const OMIT = Symbol('omit-json-value')

/**
 * Serializes a nested value in one bounded pass.
 *
 * `bigint` values become decimal strings, ancestor cycles become
 * `[Circular]`, and containers beyond configured limits become finite marker
 * values. Repeated, non-cyclic references are serialized independently.
 */
export function safeStringify(value: unknown, options: SafeStringifyOptions = {}): string | undefined {
  return stringifyJsonValue(
    value,
    '',
    0,
    options.depthLimit ?? DEFAULT_DEPTH_LIMIT,
    options.edgeLimit ?? DEFAULT_EDGE_LIMIT,
    []
  )
}

/** Serializes one JSON-compatible branch with bounded depth and edges. */
export function stringifyJsonValue(
  value: unknown,
  key: string,
  depth: number,
  depthLimit: number,
  edgeLimit: number,
  ancestors: object[]
): string | undefined {
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
      return stringifyObject(value, key, depth, depthLimit, edgeLimit, ancestors)
    default:
      return undefined
  }
}

function stringifyObject(
  value: object,
  key: string,
  depth: number,
  depthLimit: number,
  edgeLimit: number,
  ancestors: object[]
): string | undefined {
  const toJSON = (value as { toJSON?: (key: string) => unknown }).toJSON

  if (typeof toJSON === 'function') {
    const replacement = toJSON.call(value, key)

    if (replacement !== value) {
      return stringifyJsonValue(replacement, key, depth, depthLimit, edgeLimit, ancestors)
    }
  }

  if (ancestors.includes(value)) {
    return quoteString('[Circular]')
  }

  if (depth >= depthLimit) {
    return quoteString(Array.isArray(value) ? '[Array]' : '[Object]')
  }

  ancestors.push(value)

  try {
    return Array.isArray(value)
      ? stringifyArray(value, depth, depthLimit, edgeLimit, ancestors)
      : stringifyRecord(value as Record<string, unknown>, depth, depthLimit, edgeLimit, ancestors)
  } finally {
    ancestors.pop()
  }
}

function stringifyArray(
  value: unknown[],
  depth: number,
  depthLimit: number,
  edgeLimit: number,
  ancestors: object[]
): string {
  const retained = Math.min(value.length, edgeLimit)

  let output = '['

  for (let index = 0; index < retained; index += 1) {
    if (index !== 0) {
      output += ','
    }

    output += stringifyJsonValue(value[index], String(index), depth + 1, depthLimit, edgeLimit, ancestors) ?? 'null'
  }

  if (value.length > retained) {
    if (retained !== 0) {
      output += ','
    }

    output += quoteString(`... ${value.length - retained} items not stringified`)
  }

  return `${output}]`
}

function stringifyRecord(
  value: Record<string, unknown>,
  depth: number,
  depthLimit: number,
  edgeLimit: number,
  ancestors: object[]
): string {
  const keys = Object.keys(value)
  const retained = Math.min(keys.length, edgeLimit)

  let output = '{'
  let hasValue = false

  for (let index = 0; index < retained; index += 1) {
    const property = keys[index]!
    const item = stringifyJsonValue(value[property], property, depth + 1, depthLimit, edgeLimit, ancestors)

    if (item === undefined) {
      continue
    }

    if (hasValue) {
      output += ','
    }

    output += `${quoteString(property)}:${item}`
    hasValue = true
  }

  if (keys.length > retained) {
    if (hasValue) {
      output += ','
    }

    output += `${quoteString('...')}:${quoteString(`${keys.length - retained} items not stringified`)}`
  }

  return `${output}}`
}

/**
 * Serializes an Error and its cause chain in one bounded pass.
 *
 * Enumerable custom properties use the same JSON safety rules as ordinary
 * fields. Error causes are retained as nested records up to `maxCauseDepth`.
 */
export function safeStringifyError(error: Error, maxCauseDepth: number, options: SafeStringifyOptions = {}): string {
  return JSON.stringify(normalizeError(error, maxCauseDepth, options))
}

/** Converts an Error and its cause chain into one bounded JSON-safe value. */
export function normalizeError(
  error: Error,
  maxCauseDepth: number,
  options: SafeStringifyOptions = {}
): Record<string, unknown> | string {
  return normalizeErrorValue(
    error,
    0,
    0,
    maxCauseDepth,
    options.depthLimit ?? DEFAULT_DEPTH_LIMIT,
    options.edgeLimit ?? DEFAULT_EDGE_LIMIT,
    []
  )
}

function normalizeErrorValue(
  error: Error,
  causeDepth: number,
  depth: number,
  maxCauseDepth: number,
  depthLimit: number,
  edgeLimit: number,
  ancestors: object[]
): Record<string, unknown> | string {
  if (ancestors.includes(error)) {
    return '[Circular]'
  }

  if (causeDepth >= maxCauseDepth) {
    return '[Cause depth exceeded]'
  }

  if (depth >= depthLimit) {
    return '[Object]'
  }

  ancestors.push(error)

  try {
    const custom = error as Error & Record<string, unknown>
    const customKeys = Object.keys(error)
    const hasCause = 'cause' in error && error.cause !== undefined
    const type = error.constructor?.name || error.name || 'Error'
    const message = String(error.message ?? '')
    const stack = typeof error.stack === 'string' ? error.stack : String(error.stack ?? '')
    const output: Record<string, unknown> =
      edgeLimit >= 3 ? { type, message, stack } : edgeLimit === 2 ? { type, message } : edgeLimit === 1 ? { type } : {}

    let propertyCount = 3

    if (hasCause) {
      if (propertyCount < edgeLimit) {
        output.cause =
          error.cause instanceof Error
            ? normalizeErrorValue(
                error.cause,
                causeDepth + 1,
                depth + 1,
                maxCauseDepth,
                depthLimit,
                edgeLimit,
                ancestors
              )
            : normalizeJsonValue(error.cause, 'cause', depth + 1, depthLimit, edgeLimit, ancestors)
      }

      propertyCount += 1
    }

    for (const key of customKeys) {
      if (isReservedErrorKey(key)) {
        continue
      }

      if (propertyCount < edgeLimit) {
        const value = normalizeJsonValue(custom[key], key, depth + 1, depthLimit, edgeLimit, ancestors)

        if (value !== OMIT) {
          defineJsonProperty(output, key, value)
        }
      }

      propertyCount += 1
    }

    if (propertyCount > edgeLimit) {
      output['...'] = `${propertyCount - edgeLimit} items not stringified`
    }

    return output
  } finally {
    ancestors.pop()
  }
}

function isReservedErrorKey(key: string): boolean {
  return key === 'name' || key === 'message' || key === 'stack' || key === 'cause'
}

function defineJsonProperty(target: Record<string, unknown>, key: string, value: unknown): void {
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

function normalizeJsonValue(
  value: unknown,
  key: string,
  depth: number,
  depthLimit: number,
  edgeLimit: number,
  ancestors: object[]
): unknown | typeof OMIT {
  if (typeof value === 'bigint') {
    return String(value)
  }

  if (value === null || typeof value !== 'object') {
    return value === undefined || typeof value === 'function' || typeof value === 'symbol' ? OMIT : value
  }

  const toJSON = (value as { toJSON?: (key: string) => unknown }).toJSON

  if (typeof toJSON === 'function') {
    const replacement = toJSON.call(value, key)

    if (replacement !== value) {
      return normalizeJsonValue(replacement, key, depth, depthLimit, edgeLimit, ancestors)
    }
  }

  if (ancestors.includes(value)) {
    return '[Circular]'
  }

  if (depth >= depthLimit) {
    return Array.isArray(value) ? '[Array]' : '[Object]'
  }

  ancestors.push(value)

  try {
    if (Array.isArray(value)) {
      const retained = Math.min(value.length, edgeLimit)
      const output: unknown[] = new Array(retained)

      for (let index = 0; index < retained; index += 1) {
        const item = normalizeJsonValue(value[index], String(index), depth + 1, depthLimit, edgeLimit, ancestors)

        output[index] = item === OMIT ? null : item
      }

      if (value.length > retained) {
        output.push(`... ${value.length - retained} items not stringified`)
      }

      return output
    }

    const output: Record<string, unknown> = Object.create(null)
    const keys = Object.keys(value)
    const retained = Math.min(keys.length, edgeLimit)

    for (let index = 0; index < retained; index += 1) {
      const property = keys[index]!
      const item = normalizeJsonValue(
        (value as Record<string, unknown>)[property],
        property,
        depth + 1,
        depthLimit,
        edgeLimit,
        ancestors
      )

      if (item !== OMIT) {
        output[property] = item
      }
    }

    if (keys.length > retained) {
      output['...'] = `${keys.length - retained} items not stringified`
    }

    return output
  } finally {
    ancestors.pop()
  }
}
