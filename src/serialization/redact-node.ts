/** One mutable branch in the compiled redact-path trie. */
export class RedactNode {
  readonly children = new Map<string, RedactNode>()
  terminal = false
  wildcard: RedactNode | null = null
}
