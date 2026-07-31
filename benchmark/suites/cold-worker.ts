import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { measureScenario } from '@swarmmachina/benchkit/measurement'
import { parseArgs } from '@swarmmachina/benchkit/orchestration'
import { sampleV8HeapAllocations } from '@swarmmachina/benchkit/profiling'

import type { ImplementationName, WorkerResult } from '../types.js'

interface ColdArgs {
  implementation: 'swm' | 'pino'
  result: string
  allocationSamplingIntervalBytes: number
}

const args = parseArgs(
  process.argv,
  { allocationSamplingIntervalBytes: 32_768, implementation: 'swm' as 'swm' | 'pino', result: '' },
  {
    '--allocation-sampling-interval': (out, value) => {
      out.allocationSamplingIntervalBytes = Number(value)
    },
    '--implementation': (out, value) => {
      out.implementation = value as 'swm' | 'pino'
    },
    '--result': (out, value) => {
      out.result = value ?? ''
    }
  },
  { offset: 2, strict: true }
) satisfies ColdArgs
const sampled = await sampleV8HeapAllocations(
  () =>
    measureScenario({
      name: `b6/${args.implementation}`,
      connections: 1,
      pipelining: 1,
      operations: 1,
      run: async () => {
        const startedAt = performance.now()

        if (args.implementation === 'swm') {
          await import('@swarmmachina/swm-log')
        } else {
          await import('pino')
        }

        return [performance.now() - startedAt]
      }
    }),
  { samplingIntervalBytes: args.allocationSamplingIntervalBytes }
)
const result: WorkerResult = {
  allocationBytesPerOperation: sampled.sampledAllocationBytes,
  implementation: args.implementation as ImplementationName,
  measurement: sampled.value,
  sampledAllocationBytes: sampled.sampledAllocationBytes,
  scenario: 'b6'
}

await writeFile(args.result, `${JSON.stringify(result)}\n`)
