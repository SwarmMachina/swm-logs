/** Assigns an own data property without invoking the legacy `__proto__` setter. */
function assignOwnValue(target: object, key: PropertyKey, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    })

    return
  }

  ;(target as Record<PropertyKey, unknown>)[key] = value
}

export { assignOwnValue }
