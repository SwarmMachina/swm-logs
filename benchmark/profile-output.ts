import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const profileDirectory = resolve(import.meta.dirname, 'profiles')

/** Persists benchmark evidence for the CI artifact, including failed regression runs. */
async function writeBenchmarkProfile(fileName: string, profile: unknown): Promise<void> {
  await mkdir(profileDirectory, { recursive: true })
  await writeFile(resolve(profileDirectory, fileName), `${JSON.stringify(profile, null, 2)}\n`)
}

export { writeBenchmarkProfile }
