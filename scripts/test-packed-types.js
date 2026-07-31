import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, pack, root } from './package-test-helpers.js'

const temporaryDirectory = makeTempDir('swm-log-types-')

try {
  const artifacts = join(temporaryDirectory, 'artifacts')
  const consumer = join(temporaryDirectory, 'consumer')

  mkdirSync(artifacts)
  mkdirSync(consumer)

  const packed = pack(artifacts)

  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: { '@swarmmachina/swm-log': `file:${packed.path}` }
      },
      null,
      2
    )
  )
  cpSync(join(root, 'tests/fixtures/types'), join(consumer, 'fixtures'), { recursive: true })
  execFileSync('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], { cwd: consumer, stdio: 'ignore' })

  for (const [name, module, moduleResolution] of [
    ['nodenext', 'NodeNext', 'NodeNext'],
    ['bundler', 'ESNext', 'Bundler']
  ]) {
    const config = join(consumer, `tsconfig.${name}.json`)

    writeFileSync(
      config,
      JSON.stringify(
        {
          compilerOptions: {
            module,
            moduleResolution,
            noEmit: true,
            skipLibCheck: false,
            strict: true,
            target: 'ES2024',
            typeRoots: [join(root, 'node_modules/@types')],
            types: ['node']
          },
          include: ['fixtures/*.ts']
        },
        null,
        2
      )
    )
    execFileSync(join(root, 'node_modules/.bin/tsc'), ['--project', config, '--pretty', 'false'], {
      cwd: consumer,
      stdio: 'inherit'
    })
  }

  console.log('packed consumer types: NodeNext + Bundler ok')
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
