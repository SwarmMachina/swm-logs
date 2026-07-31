const HEX = '0123456789abcdef'
// JSON requires escaping ASCII control characters even on the common fast path.
// eslint-disable-next-line no-control-regex
const NEEDS_ESCAPE = /["\\\u0000-\u001f\u2028\u2029\ud800-\udfff]/

/**
 * Returns a well-formed JSON string without calling `JSON.stringify()`.
 *
 * This is used by the flat-fields hot path and includes lone-surrogate
 * handling equivalent to well-formed `JSON.stringify()`.
 */
export function quoteString(value: string): string {
  if (!NEEDS_ESCAPE.test(value)) {
    return `"${value}"`
  }

  let output = '"'
  let chunkStart = 0

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    let escape: string | undefined

    if (code === 0x22) {
      escape = '\\"'
    } else if (code === 0x5c) {
      escape = '\\\\'
    } else if (code === 0x08) {
      escape = '\\b'
    } else if (code === 0x0c) {
      escape = '\\f'
    } else if (code === 0x0a) {
      escape = '\\n'
    } else if (code === 0x0d) {
      escape = '\\r'
    } else if (code === 0x09) {
      escape = '\\t'
    } else if (code <= 0x1f || code === 0x2028 || code === 0x2029) {
      escape = unicodeEscape(code)
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)

      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1
        continue
      }

      escape = unicodeEscape(code)
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      escape = unicodeEscape(code)
    }

    if (escape !== undefined) {
      output += value.slice(chunkStart, index) + escape
      chunkStart = index + 1
    }
  }

  return output + value.slice(chunkStart) + '"'
}

function unicodeEscape(code: number): string {
  return `\\u${HEX[(code >>> 12) & 0xf]}${HEX[(code >>> 8) & 0xf]}${HEX[(code >>> 4) & 0xf]}${HEX[code & 0xf]}`
}
