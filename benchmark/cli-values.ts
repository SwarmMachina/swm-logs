function requiredValue(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) {
    throw new TypeError(`${label} is required`)
  }

  return value
}

function commaSeparatedValues(value: string | undefined): string[] {
  return requiredValue(value, 'list value')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function positiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer`)
  }

  return parsed
}

function nonNegativeInteger(value: string | undefined, label: string): number {
  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a non-negative integer`)
  }

  return parsed
}

export { commaSeparatedValues, nonNegativeInteger, positiveInteger, requiredValue }
