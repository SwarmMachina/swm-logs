import type { RedactCensor, RedactOptions } from '../types.js'
import { isFunction, isObject } from '../validation.js'
import { cloneContainer } from './clone-container.js'
import { assignOwnValue } from './own-property.js'
import { RedactNode } from './redact-node.js'
import { parseRedactPath, type PathSegment } from './redact-path.js'
import { REDACT_NOT_APPLICABLE, SinglePathRedactor } from './single-path-redactor.js'
import type { SafeStringifyOptions } from './safe-stringify.js'

interface RedactResult {
  changed: boolean
  removed?: boolean
  value: unknown
}

interface RedactPolicy {
  censor: string | RedactCensor
  remove: boolean
}

function compileTrie(paths: readonly (readonly PathSegment[])[]): RedactNode {
  const root = new RedactNode()

  for (const segments of paths) {
    let node = root

    for (const segment of segments) {
      if (node.terminal) {
        break
      }

      if (segment.wildcard) {
        node.wildcard ??= new RedactNode()
        node = node.wildcard
      } else {
        let child = node.children.get(segment.key)

        if (child === undefined) {
          child = new RedactNode()
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

function normalizeConfig(config: readonly string[] | RedactOptions): {
  paths: readonly string[]
  policy: RedactPolicy
} {
  if (Array.isArray(config)) {
    return { paths: config, policy: { censor: '[Redacted]', remove: false } }
  }

  if (!isObject(config)) {
    throw new TypeError('options.redact must be an array or an object with paths')
  }

  const options = config as RedactOptions

  if (!Array.isArray(options.paths)) {
    throw new TypeError('options.redact.paths must be an array')
  }

  if (options.remove !== undefined && typeof options.remove !== 'boolean') {
    throw new TypeError('options.redact.remove must be a boolean')
  }

  if (options.censor !== undefined && typeof options.censor !== 'string' && !isFunction(options.censor)) {
    throw new TypeError('options.redact.censor must be a string or function')
  }

  return {
    paths: options.paths,
    policy: { censor: options.censor ?? '[Redacted]', remove: options.remove ?? false }
  }
}

function redactBranch(
  value: unknown,
  selection: RedactNode | readonly RedactNode[],
  policy: RedactPolicy,
  path: string[]
): RedactResult {
  if (!isObject(value)) {
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
    if (!Object.hasOwn(record, key)) {
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
        assignOwnValue(clone, key, nested.value)
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

    const replacement = isFunction(policy.censor) ? policy.censor(value, [...path, key]) : policy.censor

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

/**
 * Owns compiled exact/wildcard redaction behavior.
 *
 * A single path receives a fused JSON serializer. Multiple paths use a branch
 * trie. Neither strategy mutates caller-owned values.
 */
class Redactor {
  readonly #policy: RedactPolicy
  readonly #root: RedactNode | null
  readonly #singlePath: SinglePathRedactor | null

  /** Parses and compiles configuration once, outside the logging hot path. */
  constructor(config: readonly string[] | RedactOptions) {
    const { paths, policy } = normalizeConfig(config)
    const parsedPaths = paths.map(parseRedactPath)

    this.#policy = policy

    if (parsedPaths.length === 1) {
      this.#root = null
      this.#singlePath = new SinglePathRedactor({ ...policy, segments: parsedPaths[0]! })

      return
    }

    this.#root = compileTrie(parsedPaths)
    this.#singlePath = null
  }

  /** Returns whether fields can be redacted during JSON serialization. */
  get supportsFusedSerialization(): boolean {
    return this.#singlePath !== null
  }

  /** Redacts a value immutably. */
  redact(value: unknown): unknown {
    if (this.#singlePath !== null) {
      return this.#singlePath.redact(value)
    }

    const root = this.#root!

    if (root.children.size === 0 && root.wildcard === null) {
      return value
    }

    return redactBranch(value, root, this.#policy, []).value
  }

  /** Serializes one top-level field through the fused single-path strategy. */
  serializeField(
    key: string,
    value: unknown,
    options: SafeStringifyOptions
  ): string | undefined | typeof REDACT_NOT_APPLICABLE {
    return this.#singlePath === null ? REDACT_NOT_APPLICABLE : this.#singlePath.serializeField(key, value, options)
  }
}

export { REDACT_NOT_APPLICABLE, Redactor }
