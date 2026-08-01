class MemoryDestination {
  readonly chunks: string[] = []

  write(chunk: string): boolean {
    this.chunks.push(chunk)

    return true
  }

  text(): string {
    return this.chunks.join('')
  }

  records() {
    return this.text()
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }
}

export { MemoryDestination }
