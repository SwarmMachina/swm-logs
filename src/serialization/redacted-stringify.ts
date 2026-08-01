import { DEFAULT_DEPTH_LIMIT, DEFAULT_EDGE_LIMIT } from '../constants.js'
import type { RedactCensor } from '../types.js'
import { isFunction, isObject } from '../validation.js'
import { quoteString } from './quote-string.js'
import { stringifyJsonValue, type SafeStringifyOptions } from './safe-stringify.js'

/** Requests clone-first redaction when a selected branch owns custom JSON behavior. */
const REDACT_STRINGIFY_FALLBACK = Symbol('redact-stringify-fallback')

type RedactedStringifyResult = string | undefined | typeof REDACT_STRINGIFY_FALLBACK

/** Precompiled single-path redaction state consumed by the fused serializer. */
interface RedactedStringifyConfig {
  censor: string | RedactCensor
  remove: boolean
  segments: readonly RedactedStringifySegment[]
  staticCensorJson: string | null
}

/** One exact or wildcard branch in a precompiled redact path. */
interface RedactedStringifySegment {
  key: string
  wildcard: boolean
}

/** Serializes and redacts one nested value without cloning it first. */
function safeStringifyRedacted(
  value: unknown,
  options: SafeStringifyOptions,
  config: RedactedStringifyConfig,
  segmentIndex: number,
  path: string[] | null
): RedactedStringifyResult {
  return stringifyRedactedJsonValue(
    value,
    '',
    0,
    options.depthLimit ?? DEFAULT_DEPTH_LIMIT,
    options.edgeLimit ?? DEFAULT_EDGE_LIMIT,
    [],
    config,
    segmentIndex,
    path
  )
}

function stringifyRedactedJsonValue(
  value: unknown,
  key: string,
  depth: number,
  depthLimit: number,
  edgeLimit: number,
  ancestors: object[],
  config: RedactedStringifyConfig,
  segmentIndex: number,
  path: string[] | null
): RedactedStringifyResult {
  if (segmentIndex === config.segments.length) {
    if (config.remove) {
      return undefined
    }

    if (config.staticCensorJson !== null) {
      return config.staticCensorJson
    }

    const replacement = isFunction(config.censor) ? config.censor(value, path === null ? [] : [...path]) : config.censor

    return stringifyJsonValue(replacement, key, depth, depthLimit, edgeLimit, ancestors)
  }

  if (!isObject(value)) {
    return stringifyJsonValue(value, key, depth, depthLimit, edgeLimit, ancestors)
  }

  const toJSON = (value as { toJSON?: (key: string) => unknown }).toJSON

  if (isFunction(toJSON)) {
    return REDACT_STRINGIFY_FALLBACK
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
      ? stringifyRedactedArray(value, depth, depthLimit, edgeLimit, ancestors, config, segmentIndex, path)
      : stringifyRedactedRecord(
          value as Record<string, unknown>,
          depth,
          depthLimit,
          edgeLimit,
          ancestors,
          config,
          segmentIndex,
          path
        )
  } finally {
    ancestors.pop()
  }
}

function stringifyRedactedArray(
  value: unknown[],
  depth: number,
  depthLimit: number,
  edgeLimit: number,
  ancestors: object[],
  config: RedactedStringifyConfig,
  segmentIndex: number,
  path: string[] | null
): string | typeof REDACT_STRINGIFY_FALLBACK {
  const retained = Math.min(value.length, edgeLimit)
  const segment = config.segments[segmentIndex]!

  let output = '['

  for (let index = 0; index < retained; index += 1) {
    if (index !== 0) {
      output += ','
    }

    const property = String(index)
    const matches = segment.wildcard || segment.key === property

    let item: RedactedStringifyResult

    if (matches) {
      if (segmentIndex + 1 === config.segments.length && config.staticCensorJson !== null) {
        item = config.staticCensorJson
      } else if (segmentIndex + 1 === config.segments.length && config.remove) {
        item = undefined
      } else {
        path?.push(property)

        try {
          item = stringifyRedactedJsonValue(
            value[index],
            property,
            depth + 1,
            depthLimit,
            edgeLimit,
            ancestors,
            config,
            segmentIndex + 1,
            path
          )
        } finally {
          path?.pop()
        }
      }
    } else {
      item = stringifyJsonValue(value[index], property, depth + 1, depthLimit, edgeLimit, ancestors)
    }

    if (item === REDACT_STRINGIFY_FALLBACK) {
      return item
    }

    output += item ?? 'null'
  }

  if (value.length > retained) {
    if (retained !== 0) {
      output += ','
    }

    output += quoteString(`... ${value.length - retained} items not stringified`)
  }

  return `${output}]`
}

function stringifyRedactedRecord(
  value: Record<string, unknown>,
  depth: number,
  depthLimit: number,
  edgeLimit: number,
  ancestors: object[],
  config: RedactedStringifyConfig,
  segmentIndex: number,
  path: string[] | null
): string | typeof REDACT_STRINGIFY_FALLBACK {
  const keys = Object.keys(value)
  const retained = Math.min(keys.length, edgeLimit)
  const segment = config.segments[segmentIndex]!

  let output = '{'
  let hasValue = false

  for (let index = 0; index < retained; index += 1) {
    const property = keys[index]!
    const matches = segment.wildcard || segment.key === property

    let item: RedactedStringifyResult

    if (matches) {
      if (segmentIndex + 1 === config.segments.length && config.staticCensorJson !== null) {
        item = config.staticCensorJson
      } else if (segmentIndex + 1 === config.segments.length && config.remove) {
        item = undefined
      } else {
        path?.push(property)

        try {
          item = stringifyRedactedJsonValue(
            value[property],
            property,
            depth + 1,
            depthLimit,
            edgeLimit,
            ancestors,
            config,
            segmentIndex + 1,
            path
          )
        } finally {
          path?.pop()
        }
      }
    } else {
      item = stringifyJsonValue(value[property], property, depth + 1, depthLimit, edgeLimit, ancestors)
    }

    if (item === REDACT_STRINGIFY_FALLBACK) {
      return item
    }

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

export { REDACT_STRINGIFY_FALLBACK, safeStringifyRedacted }
export type { RedactedStringifyConfig, RedactedStringifySegment }
