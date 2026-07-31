import type { RedactCensor, RedactOptions } from '../types.js'
import { quoteString } from './quote-string.js'
import { parseRedactPath, type PathSegment } from './redact-path.js'
import { REDACT_STRINGIFY_FALLBACK, safeStringifyRedacted, type RedactedStringifyConfig } from './redacted-stringify.js'
import { safeStringify, type SafeStringifyOptions } from './safe-stringify.js'

/** Signals that a field does not belong to the compiled single-path fast path. */
export const REDACT_NOT_APPLICABLE = Symbol('redact-not-applicable')

type RedactValue = (value: unknown) => unknown
type SerializeField = (
  key: string,
  value: unknown,
  options: SafeStringifyOptions
) => string | undefined | typeof REDACT_NOT_APPLICABLE

interface RedactNode {
  terminal: boolean
  children: Map<string, RedactNode>
  wildcard: RedactNode | null
}

interface RedactResult {
  changed: boolean
  removed?: boolean
  value: unknown
}

interface RedactPolicy {
  censor: string | RedactCensor
  remove: boolean
}

const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty) as (value: object, property: PropertyKey) => boolean
const REMOVE = Symbol('remove-redacted-value')
const UNCHANGED = Symbol('unchanged-redacted-value')

type BranchResult = unknown | typeof REMOVE | typeof UNCHANGED
type StaticBranchRedactor = (value: unknown) => BranchResult
type DynamicBranchRedactor = (value: unknown, path: string[]) => BranchResult

/**
 * Owns compiled exact/wildcard redaction behavior.
 *
 * A single path receives a fused JSON serializer. Multiple paths use a branch
 * trie. Neither strategy mutates caller-owned values.
 */
export class Redactor {
  readonly #redactValue: RedactValue
  readonly #serializeField: SerializeField | null

  /** Parses and compiles configuration once, outside the logging hot path. */
  constructor(config: readonly string[] | RedactOptions) {
    const { paths, policy } = normalizeConfig(config)
    const parsedPaths = paths.map(parseRedactPath)

    if (parsedPaths.length === 1) {
      const segments = parsedPaths[0]!

      this.#redactValue = compileSinglePathRedactor(segments, policy)
      this.#serializeField = compileFieldSerializer(this.#redactValue, segments, policy)

      return
    }

    const root = compileTrie(parsedPaths)

    this.#redactValue =
      root.children.size === 0 && root.wildcard === null
        ? (value) => value
        : (value) => redactBranch(value, root, policy, []).value
    this.#serializeField = null
  }

  /** Returns whether fields can be redacted during JSON serialization. */
  get supportsFusedSerialization(): boolean {
    return this.#serializeField !== null
  }

  /** Redacts a value immutably. */
  redact(value: unknown): unknown {
    return this.#redactValue(value)
  }

  /** Serializes one top-level field through the fused single-path strategy. */
  serializeField(
    key: string,
    value: unknown,
    options: SafeStringifyOptions
  ): string | undefined | typeof REDACT_NOT_APPLICABLE {
    return this.#serializeField === null ? REDACT_NOT_APPLICABLE : this.#serializeField(key, value, options)
  }
}

function compileTrie(paths: readonly (readonly PathSegment[])[]): RedactNode {
  const root = makeNode()

  for (const segments of paths) {
    let node = root

    for (const segment of segments) {
      if (node.terminal) {
        break
      }

      if (segment.wildcard) {
        node.wildcard ??= makeNode()
        node = node.wildcard
      } else {
        let child = node.children.get(segment.key)

        if (child === undefined) {
          child = makeNode()
          node.children.set(segment.key, child)
        }

        node = child
      }
    }

    node.terminal = true
    node.children.clear()
    node.wildcard = null
  }

  return root
}

function compileSinglePathRedactor(segments: readonly PathSegment[], policy: RedactPolicy): RedactValue {
  if (typeof policy.censor === 'function' && !policy.remove) {
    return compileDynamicSinglePathRedactor(segments, policy.censor)
  }

  let branch: StaticBranchRedactor = policy.remove ? () => REMOVE : () => policy.censor

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!

    branch = segment.wildcard ? wrapStaticWildcard(branch) : wrapStaticExact(segment.key, branch)
  }

  return (value) => {
    const redacted = branch(value)

    return redacted === UNCHANGED || redacted === REMOVE ? value : redacted
  }
}

function compileFieldSerializer(
  redactValue: RedactValue,
  segments: readonly PathSegment[],
  policy: RedactPolicy
): SerializeField {
  const config: RedactedStringifyConfig = {
    ...policy,
    segments,
    staticCensorJson: !policy.remove && typeof policy.censor === 'string' ? quoteString(policy.censor) : null
  }
  const first = config.segments[0]!
  const dynamicPath = typeof config.censor === 'function' && !config.remove

  return (key, value, options) => {
    if (!first.wildcard && first.key !== key) {
      return REDACT_NOT_APPLICABLE
    }

    const serialized = safeStringifyRedacted(value, options, config, 1, dynamicPath ? [key] : null)

    if (serialized !== REDACT_STRINGIFY_FALLBACK) {
      return serialized
    }

    const wrapper = { [key]: value }
    const redacted = redactValue(wrapper) as Record<string, unknown>

    return hasOwn(redacted, key) ? safeStringify(redacted[key], options) : undefined
  }
}

function wrapStaticExact(key: string, next: StaticBranchRedactor): StaticBranchRedactor {
  return (value) => {
    if (value === null || typeof value !== 'object' || !hasOwn(value, key)) {
      return UNCHANGED
    }

    const record = value as Record<string, unknown>
    const nested = next(record[key])

    if (nested === UNCHANGED) {
      return UNCHANGED
    }

    const clone = cloneContainer(record)

    if (nested === REMOVE) {
      delete (clone as Record<string, unknown>)[key]
    } else {
      defineValue(clone, key, nested)
    }

    return clone
  }
}

function wrapStaticWildcard(next: StaticBranchRedactor): StaticBranchRedactor {
  return (value) => {
    if (value === null || typeof value !== 'object') {
      return UNCHANGED
    }

    if (Array.isArray(value)) {
      let clone: unknown[] | undefined

      for (let index = 0; index < value.length; index += 1) {
        if (!hasOwn(value, index)) {
          continue
        }

        const nested = next(value[index])

        if (nested !== UNCHANGED) {
          clone ??= [...value]

          if (nested === REMOVE) {
            delete clone[index]
          } else {
            clone[index] = nested
          }
        }
      }

      return clone ?? UNCHANGED
    }

    const record = value as Record<string, unknown>

    let clone: Record<string, unknown> | undefined

    for (const key of Object.keys(record)) {
      const nested = next(record[key])

      if (nested !== UNCHANGED) {
        clone ??= { ...record }

        if (nested === REMOVE) {
          delete clone[key]
        } else {
          defineValue(clone, key, nested)
        }
      }
    }

    return clone ?? UNCHANGED
  }
}

function compileDynamicSinglePathRedactor(segments: readonly PathSegment[], censor: RedactCensor): RedactValue {
  let branch: DynamicBranchRedactor = (value, path) => censor(value, [...path])

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!

    branch = segment.wildcard ? wrapDynamicWildcard(branch) : wrapDynamicExact(segment.key, branch)
  }

  return (value) => {
    const redacted = branch(value, [])

    return redacted === UNCHANGED || redacted === REMOVE ? value : redacted
  }
}

function wrapDynamicExact(key: string, next: DynamicBranchRedactor): DynamicBranchRedactor {
  return (value, path) => {
    if (value === null || typeof value !== 'object' || !hasOwn(value, key)) {
      return UNCHANGED
    }

    const record = value as Record<string, unknown>

    path.push(key)

    try {
      const nested = next(record[key], path)

      if (nested === UNCHANGED) {
        return UNCHANGED
      }

      const clone = cloneContainer(record)

      if (nested === REMOVE) {
        delete (clone as Record<string, unknown>)[key]
      } else {
        defineValue(clone, key, nested)
      }

      return clone
    } finally {
      path.pop()
    }
  }
}

function wrapDynamicWildcard(next: DynamicBranchRedactor): DynamicBranchRedactor {
  return (value, path) => {
    if (value === null || typeof value !== 'object') {
      return UNCHANGED
    }

    const record = value as Record<string, unknown>
    const keys = Object.keys(record)

    let clone: Record<string, unknown> | unknown[] | undefined

    for (const key of keys) {
      path.push(key)

      try {
        const nested = next(record[key], path)

        if (nested !== UNCHANGED) {
          clone ??= cloneContainer(record)

          if (nested === REMOVE) {
            delete (clone as Record<string, unknown>)[key]
          } else {
            defineValue(clone, key, nested)
          }
        }
      } finally {
        path.pop()
      }
    }

    return clone ?? UNCHANGED
  }
}

function normalizeConfig(config: readonly string[] | RedactOptions): {
  paths: readonly string[]
  policy: RedactPolicy
} {
  if (Array.isArray(config)) {
    return { paths: config, policy: { censor: '[Redacted]', remove: false } }
  }

  if (config === null || typeof config !== 'object') {
    throw new TypeError('options.redact must be an array or an object with paths')
  }

  const options = config as RedactOptions

  if (!Array.isArray(options.paths)) {
    throw new TypeError('options.redact.paths must be an array')
  }

  if (options.remove !== undefined && typeof options.remove !== 'boolean') {
    throw new TypeError('options.redact.remove must be a boolean')
  }

  if (options.censor !== undefined && typeof options.censor !== 'string' && typeof options.censor !== 'function') {
    throw new TypeError('options.redact.censor must be a string or function')
  }

  return {
    paths: options.paths,
    policy: { censor: options.censor ?? '[Redacted]', remove: options.remove ?? false }
  }
}

function makeNode(): RedactNode {
  return { terminal: false, children: new Map(), wildcard: null }
}

function redactBranch(
  value: unknown,
  selection: RedactNode | readonly RedactNode[],
  policy: RedactPolicy,
  path: string[]
): RedactResult {
  if (value === null || typeof value !== 'object') {
    return { changed: false, value }
  }

  const record = value as Record<string, unknown>
  const keys = isNodeArray(selection)
    ? candidateKeys(record, selection)
    : selection.wildcard === null
      ? selection.children.keys()
      : Object.keys(record)

  let clone: Record<string, unknown> | unknown[] | undefined

  for (const key of keys) {
    if (!hasOwn(record, key)) {
      continue
    }

    const childSelection = matchingSelection(selection, key)

    if (childSelection === null) {
      continue
    }

    const nested = redactMatch(record[key], childSelection, policy, path, key)

    if (nested.changed) {
      clone ??= cloneContainer(record)

      if (nested.removed) {
        delete (clone as Record<string, unknown>)[key]
      } else {
        defineValue(clone, key, nested.value)
      }
    }
  }

  return clone === undefined ? { changed: false, value } : { changed: true, value: clone }
}

function redactMatch(
  value: unknown,
  selection: RedactNode | readonly RedactNode[],
  policy: RedactPolicy,
  path: string[],
  key: string
): RedactResult {
  if (hasTerminal(selection)) {
    if (policy.remove) {
      return { changed: true, removed: true, value: undefined }
    }

    const replacement = typeof policy.censor === 'function' ? policy.censor(value, [...path, key]) : policy.censor

    return { changed: true, value: replacement }
  }

  path.push(key)

  try {
    return redactBranch(value, selection, policy, path)
  } finally {
    path.pop()
  }
}

function matchingSelection(
  selection: RedactNode | readonly RedactNode[],
  key: string
): RedactNode | readonly RedactNode[] | null {
  if (isNodeArray(selection)) {
    const matches = matchingChildren(selection, key)

    return matches.length === 0 ? null : matches.length === 1 ? matches[0]! : matches
  }

  const exact = selection.children.get(key)
  const wildcard = selection.wildcard

  if (exact !== undefined && wildcard !== null) {
    return [exact, wildcard]
  }

  return exact ?? wildcard
}

function hasTerminal(selection: RedactNode | readonly RedactNode[]): boolean {
  return isNodeArray(selection) ? selection.some((node) => node.terminal) : selection.terminal
}

function isNodeArray(selection: RedactNode | readonly RedactNode[]): selection is readonly RedactNode[] {
  return Array.isArray(selection)
}

function candidateKeys(record: Record<string, unknown>, nodes: readonly RedactNode[]): Set<string> {
  const keys = new Set<string>()

  for (const node of nodes) {
    for (const key of node.children.keys()) {
      keys.add(key)
    }

    if (node.wildcard !== null) {
      for (const key of Object.keys(record)) {
        keys.add(key)
      }
    }
  }

  return keys
}

function matchingChildren(nodes: readonly RedactNode[], key: string): RedactNode[] {
  const matches: RedactNode[] = []

  for (const node of nodes) {
    const exact = node.children.get(key)

    if (exact !== undefined) {
      if (!matches.includes(exact)) {
        matches.push(exact)
      }
    }

    if (node.wildcard !== null) {
      if (!matches.includes(node.wildcard)) {
        matches.push(node.wildcard)
      }
    }
  }

  return matches
}

function cloneContainer(value: Record<string, unknown>): Record<string, unknown> | unknown[] {
  return Array.isArray(value) ? [...value] : { ...value }
}

function defineValue(target: object, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    })
  } else {
    const record = target as Record<string, unknown>

    record[key] = value
  }
}
