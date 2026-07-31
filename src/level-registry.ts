import { LEVELS } from './constants.js'
import type { CustomLevels } from './types.js'

/** A validated level name/value pair. */
export interface ResolvedLevel {
  label: string | number
  value: number
}

/** Owns immutable level lookup tables and level resolution. */
export class LevelRegistry {
  readonly #labels: Readonly<Record<number, string>>
  readonly #values: Readonly<Record<string, number>>

  constructor(customLevels: CustomLevels | undefined) {
    if (
      customLevels !== undefined &&
      (customLevels === null || typeof customLevels !== 'object' || Array.isArray(customLevels))
    ) {
      throw new TypeError('options.customLevels must be an object')
    }

    const values: Record<string, number> = Object.assign(Object.create(null), LEVELS)

    for (const [name, value] of Object.entries(customLevels ?? {})) {
      if (name.length === 0 || Object.hasOwn(LEVELS, name)) {
        throw new TypeError(`custom level name "${name}" collides with a built-in level`)
      }

      if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`custom level "${name}" must be a non-negative safe integer`)
      }

      values[name] = value
    }

    const labels: Record<number, string> = Object.create(null)

    for (const [name, value] of Object.entries(values)) {
      labels[value] = name
    }

    this.#labels = Object.freeze(labels)
    this.#values = Object.freeze(values)
  }

  /** Returns a configured label for a numeric severity. */
  labelFor(value: number): string | undefined {
    return this.#labels[value]
  }

  /** Resolves a configured name, numeric severity, or `silent`. */
  resolve(level: unknown, label: string): ResolvedLevel {
    if (level === 'silent') {
      return { label: 'silent', value: Number.POSITIVE_INFINITY }
    }

    if (typeof level === 'string' && Object.hasOwn(this.#values, level)) {
      return { label: level, value: this.#values[level]! }
    }

    if (typeof level === 'number' && Number.isSafeInteger(level) && level >= 0) {
      return { label: level, value: level }
    }

    throw new TypeError(`${label} must be "silent", a configured level name, or a non-negative safe integer`)
  }
}
