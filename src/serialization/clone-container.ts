function cloneContainer(value: Record<string, unknown>): Record<string, unknown> | unknown[] {
  return Array.isArray(value) ? [...value] : { ...value }
}

export { cloneContainer }
