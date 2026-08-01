/** One exact or wildcard segment in a parsed redact path. */
interface PathSegment {
  key: string
  wildcard: boolean
}

const SINGLE_QUOTE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "'": "'",
  '0': '\0',
  '\\': '\\',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v'
})

/** Parses a dot/bracket redact path without code generation. */
function parseRedactPath(path: unknown): PathSegment[] {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('each redact path must be a non-empty string')
  }

  const segments: PathSegment[] = []

  let index = 0

  while (index < path.length) {
    if (path[index] === '.') {
      throw new TypeError(`invalid redact path "${path}": empty path segment`)
    }

    if (path[index] === '[') {
      const bracket = readBracketSegment(path, index)

      segments.push(bracket.segment)
      index = bracket.next
    } else {
      const start = index

      while (index < path.length && path[index] !== '.' && path[index] !== '[') {
        index += 1
      }

      const key = path.slice(start, index)

      if (key.length === 0 || key.includes(']')) {
        throw new TypeError(`invalid redact path "${path}"`)
      }

      segments.push({ key, wildcard: key === '*' })
    }

    if (index >= path.length) {
      break
    }

    if (path[index] === '.') {
      index += 1

      if (index >= path.length) {
        throw new TypeError(`invalid redact path "${path}": empty path segment`)
      }
    } else if (path[index] !== '[') {
      throw new TypeError(`invalid redact path "${path}"`)
    }
  }

  return segments
}

function readBracketSegment(path: string, start: number): { next: number; segment: PathSegment } {
  let index = start + 1

  while (path[index] === ' ') {
    index += 1
  }

  const quote = path[index]

  if (quote === '"' || quote === "'") {
    const valueStart = index

    index += 1

    while (index < path.length) {
      if (path[index] === '\\') {
        index += 2
        continue
      }

      if (path[index] === quote) {
        break
      }

      index += 1
    }

    if (index >= path.length) {
      throw new TypeError(`invalid redact path "${path}": unterminated bracket string`)
    }

    const raw = path.slice(valueStart, index + 1)
    const key = quote === '"' ? parseDoubleQuoted(raw, path) : parseSingleQuoted(raw, path)

    index += 1

    while (path[index] === ' ') {
      index += 1
    }

    if (path[index] !== ']') {
      throw new TypeError(`invalid redact path "${path}": expected ]`)
    }

    return { next: index + 1, segment: { key, wildcard: false } }
  }

  const valueStart = index

  while (index < path.length && path[index] !== ']') {
    index += 1
  }

  if (index >= path.length) {
    throw new TypeError(`invalid redact path "${path}": expected ]`)
  }

  const value = path.slice(valueStart, index).trim()

  if (value !== '*' && !/^\d+$/.test(value)) {
    throw new TypeError(`invalid redact path "${path}": bracket key must be quoted, numeric, or *`)
  }

  return { next: index + 1, segment: { key: value, wildcard: value === '*' } }
}

function parseDoubleQuoted(raw: string, path: string): string {
  try {
    return JSON.parse(raw) as string
  } catch {
    throw new TypeError(`invalid redact path "${path}": invalid quoted key`)
  }
}

function parseSingleQuoted(raw: string, path: string): string {
  const body = raw.slice(1, -1)

  if (/\\(?!['\\bnrtvf0])/u.test(body)) {
    throw new TypeError(`invalid redact path "${path}": invalid quoted key escape`)
  }

  return body.replace(/\\(['\\bnrtvf0])/gu, (_match, token: string) => SINGLE_QUOTE_ESCAPES[token]!)
}

export { parseRedactPath }
export type { PathSegment }
