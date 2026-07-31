import { safeStringify, type SafeStringifyOptions } from './serialization/safe-stringify.js'
import type { LogArguments, LogFields } from './types.js'

interface ParsedLogArguments {
  fields: LogFields | null
  message: string | undefined
}

/** Separates structured fields from the formatted message. */
export function parseLogArguments(args: LogArguments, stringifyOptions: SafeStringifyOptions): ParsedLogArguments {
  if (args.length === 0) {
    return { fields: null, message: undefined }
  }

  const first = args[0]

  if (first instanceof Error) {
    return {
      fields: { err: first },
      message: args.length > 1 ? formatMessage(args, 1, stringifyOptions) : String(first.message)
    }
  }

  if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
    const fields = first as LogFields

    let message: string | undefined

    if (args.length > 1) {
      message = formatMessage(args, 1, stringifyOptions)
    } else if (Object.hasOwn(fields, 'msg') && fields.msg !== undefined) {
      message = String(fields.msg)
    }

    return { fields, message }
  }

  return { fields: null, message: formatMessage(args, 0, stringifyOptions) }
}

function formatMessage(
  args: readonly unknown[],
  start: number,
  stringifyOptions: SafeStringifyOptions
): string | undefined {
  if (start >= args.length) {
    return undefined
  }

  const first = args[start]

  if (typeof first !== 'string' || start + 1 === args.length) {
    let message = messageValue(first, stringifyOptions)

    for (let index = start + 1; index < args.length; index += 1) {
      message += ` ${messageValue(args[index], stringifyOptions)}`
    }

    return message
  }

  let argumentIndex = start + 1

  const formatted = first.replace(/%[sdifjoO%]/g, (token) => {
    if (token === '%%') {
      return '%'
    }

    if (argumentIndex >= args.length) {
      return token
    }

    const value = args[argumentIndex]

    argumentIndex += 1

    switch (token) {
      case '%d':
      case '%f':
        return String(Number(value))
      case '%i':
        return String(Number.parseInt(String(value), 10))
      case '%j':
      case '%o':
      case '%O':
        return messageJson(value, stringifyOptions)
      default:
        return String(value)
    }
  })

  if (argumentIndex >= args.length) {
    return formatted
  }

  let message = formatted

  for (; argumentIndex < args.length; argumentIndex += 1) {
    message += ` ${messageValue(args[argumentIndex], stringifyOptions)}`
  }

  return message
}

function messageValue(value: unknown, stringifyOptions: SafeStringifyOptions): string {
  if (value instanceof Error) {
    return value.stack || value.message
  }

  if (value !== null && typeof value === 'object') {
    return messageJson(value, stringifyOptions)
  }

  return String(value)
}

function messageJson(value: unknown, stringifyOptions: SafeStringifyOptions): string {
  return safeStringify(value, stringifyOptions) ?? String(value)
}
