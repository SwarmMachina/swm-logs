/** Checks an own property without consulting the value's prototype chain. */
export const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty) as (
  value: object,
  property: PropertyKey
) => boolean

/** Assigns an own data property without invoking the legacy `__proto__` setter. */
export function assignOwnValue(target: object, key: PropertyKey, value: unknown): void {
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
