import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { ESLint } from 'eslint'

import { root } from './project-root.js'

const CODE_FENCE = /```(js|ts)\n([\s\S]*?)```/g

/**
 * Extracts JavaScript and TypeScript fences in source order.
 * @param {string} markdown
 * @returns {{ language: string, source: string }[]}
 */
function extractCodeExamples(markdown) {
  return [...markdown.matchAll(CODE_FENCE)].map((match) => ({ language: match[1], source: match[2] }))
}

/** @returns {Promise<void>} */
async function main() {
  const markdown = await readFile(path.join(root, 'README.md'), 'utf8')
  const examples = extractCodeExamples(markdown)
  const eslint = new ESLint({ cwd: root })
  const results = []

  for (const [index, example] of examples.entries()) {
    const [result] = await eslint.lintText(example.source, {
      filePath: path.join(root, `README.example-${index + 1}.${example.language}`)
    })

    results.push(result)
  }

  const problemCount = results.reduce((total, result) => total + result.errorCount + result.warningCount, 0)

  if (problemCount !== 0) {
    const formatter = await eslint.loadFormatter('stylish')

    throw new Error(`README code examples failed lint:\n${formatter.format(results)}`)
  }

  console.log(`README code examples: ${examples.length} lint clean`)
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

export { extractCodeExamples }
