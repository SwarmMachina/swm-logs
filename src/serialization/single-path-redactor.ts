import type { RedactCensor } from '../types.js'
import { isFunction, isObject } from '../validation.js'
import { cloneContainer } from './clone-container.js'
import { assignOwnValue } from './own-property.js'
import { quoteString } from './quote-string.js'
import type { PathSegment } from './redact-path.js'
import { REDACT_STRINGIFY_FALLBACK, safeStringifyRedacted, type RedactedStringifyConfig } from './redacted-stringify.js'
import { safeStringify, type SafeStringifyOptions } from './safe-stringify.js'

/** Signals that a field does not belong to the single-path fused serializer. */
const REDACT_NOT_APPLICABLE = Symbol('redact-not-applicable')
const REMOVE = Symbol('remove-redacted-value')
const UNCHANGED = Symbol('unchanged-redacted-value')

type RedactValue = unknown | typeof REMOVE | typeof UNCHANGED

interface SinglePathRedactorOptions {
  censor: string | RedactCensor
  remove: boolean
  segments: readonly PathSegment[]
}

function* iterableKeys(value: Record<string, unknown>): Iterable<string> {
  if (!Array.isArray(value)) {
    yield* Object.keys(value)

    return
  }

  for (let index = 0; index < value.length; index += 1) {
    if (Object.hasOwn(value, index)) {
      yield String(index)
    }
  }
}

/** Owns immutable redaction and fused serialization for one configured path. */
class SinglePathRedactor {
  readonly #config: RedactedStringifyConfig

  constructor(options: SinglePathRedactorOptions) {
    this.#config = {
      ...options,
      staticCensorJson: !options.remove && typeof options.censor === 'string' ? quoteString(options.censor) : null
    }
  }

  /** Redacts a value without mutating the caller-owned object graph. */
  redact(value: unknown): unknown {
    const redacted = this.#redactAt(value, 0, isFunction(this.#config.censor) ? [] : null)

    return redacted === UNCHANGED || redacted === REMOVE ? value : redacted
  }

  /** Serializes one matching top-level field without allocating redacted clones. */
  serializeField(
    key: string,
    value: unknown,
    options: SafeStringifyOptions
  ): string | undefined | typeof REDACT_NOT_APPLICABLE {
    const first = this.#config.segments[0]!

    if (!first.wildcard && first.key !== key) {
      return REDACT_NOT_APPLICABLE
    }

    const serialized = safeStringifyRedacted(
      value,
      options,
      this.#config,
      1,
      isFunction(this.#config.censor) && !this.#config.remove ? [key] : null
    )

    if (serialized !== REDACT_STRINGIFY_FALLBACK) {
      return serialized
    }

    const redacted = this.redact({ [key]: value }) as Record<string, unknown>

    return Object.hasOwn(redacted, key) ? safeStringify(redacted[key], options) : undefined
  }

  #redactAt(value: unknown, segmentIndex: number, path: string[] | null): RedactValue {
    if (segmentIndex === this.#config.segments.length) {
      if (this.#config.remove) {
        return REMOVE
      }

      return isFunction(this.#config.censor) ? this.#config.censor(value, [...path!]) : this.#config.censor
    }

    if (!isObject(value)) {
      return UNCHANGED
    }

    const segment = this.#config.segments[segmentIndex]!

    return segment.wildcard
      ? this.#redactWildcard(value as Record<string, unknown>, segmentIndex, path)
      : this.#redactExact(value as Record<string, unknown>, segment.key, segmentIndex, path)
  }

  #redactExact(value: Record<string, unknown>, key: string, segmentIndex: number, path: string[] | null): RedactValue {
    if (!Object.hasOwn(value, key)) {
      return UNCHANGED
    }

    path?.push(key)

    try {
      const nested = this.#redactAt(value[key], segmentIndex + 1, path)

      if (nested === UNCHANGED) {
        return UNCHANGED
      }

      const clone = cloneContainer(value)

      if (nested === REMOVE) {
        delete (clone as Record<string, unknown>)[key]
      } else {
        assignOwnValue(clone, key, nested)
      }

      return clone
    } finally {
      path?.pop()
    }
  }

  #redactWildcard(value: Record<string, unknown>, segmentIndex: number, path: string[] | null): RedactValue {
    let clone: Record<string, unknown> | unknown[] | undefined

    for (const key of iterableKeys(value)) {
      path?.push(key)

      try {
        const nested = this.#redactAt(value[key], segmentIndex + 1, path)

        if (nested === UNCHANGED) {
          continue
        }

        clone ??= cloneContainer(value)

        if (nested === REMOVE) {
          delete (clone as Record<string, unknown>)[key]
        } else {
          assignOwnValue(clone, key, nested)
        }
      } finally {
        path?.pop()
      }
    }

    return clone ?? UNCHANGED
  }
}

export { REDACT_NOT_APPLICABLE, SinglePathRedactor }
export type { SinglePathRedactorOptions }
