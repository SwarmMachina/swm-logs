type Callable = (...args: never[]) => unknown

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value)
}

function assertRecord<T>(value: T, label: string): asserts value is T & Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`)
  }
}

function isFunction(value: unknown): value is Callable {
  return typeof value === 'function'
}

function assertFunction<T>(value: T, label: string): asserts value is T & Callable {
  if (!isFunction(value)) {
    throw new TypeError(`${label} must be a function`)
  }
}

function assertOptionalFunction<T>(value: T, label: string): asserts value is T & (Callable | undefined) {
  if (value !== undefined) {
    assertFunction(value, label)
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function positiveInteger(value: unknown, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback
  }

  if (!isPositiveInteger(value)) {
    throw new TypeError(`${label} must be a positive integer`)
  }

  return value
}

function nonNegativeInteger(value: unknown, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback
  }

  if (!isNonNegativeInteger(value)) {
    throw new TypeError(`${label} must be a non-negative integer`)
  }

  return value
}

function asNonNegativeInteger(value: unknown): number | undefined {
  return isNonNegativeInteger(value) ? value : undefined
}

export {
  asNonNegativeInteger,
  assertFunction,
  assertOptionalFunction,
  assertRecord,
  isFunction,
  isNonNegativeInteger,
  isObject,
  isPositiveInteger,
  isRecord,
  nonNegativeInteger,
  positiveInteger
}
