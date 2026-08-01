import { appendStepSummary, mdTable } from '@swarmmachina/benchkit/reporting'

import { runBenchmark } from './bench.js'
import { compareBenchmarkRuns } from './paired-benchmark-comparison.js'
import type { BenchmarkMedianRow, BenchmarkRunRow, ImplementationName } from './types.js'

const runs = 4
const variants: ImplementationName[] = ['swm-hook', 'swm-formatter', 'swm-transport', 'swm-fanout-3']
const extensionRows = []

for (const variant of variants) {
  const result = await runBenchmark({
    allocationSamplingIntervalBytes: 32_768,
    destination: 'null',
    implementations: [variant, 'swm'],
    operations: 150_000,
    runs,
    scenarios: ['b2'],
    v8prof: false,
    warmup: 1
  })
  const candidate = result.median.find((row) => row.implementation === variant)!
  const reference = result.median.find((row) => row.implementation === 'swm')!

  extensionRows.push(compareRows(variant, candidate, reference, result.runs))
}

const wildcard = await runBenchmark({
  allocationSamplingIntervalBytes: 32_768,
  destination: 'null',
  implementations: ['swm', 'pino-sync'],
  operations: 80_000,
  runs,
  scenarios: ['b7'],
  v8prof: false,
  warmup: 1
})
const wildcardSwm = wildcard.median.find((row) => row.implementation === 'swm')!
const wildcardPino = wildcard.median.find((row) => row.implementation === 'pino-sync')!
const wildcardComparison = compareRows('swm-wildcard', wildcardSwm, wildcardPino, wildcard.runs)
const wildcardFailures: string[] = []

if (wildcardComparison.throughputDeltaPct <= 0) {
  wildcardFailures.push('B7 swm-log median paired throughput did not exceed pino-sync')
}

if (wildcardComparison.p99DeltaPct > 0) {
  wildcardFailures.push('B7 swm-log median paired p99 exceeded pino-sync')
}

const markdown = [
  '## swm-log extension profile',
  '',
  `Parameters: runs=${runs} (alternating AB/BA), warmup=1, connections=1, pipelining=1, duration=operation-bound, destination=/dev/null, B2 operations=150000, B7 operations=80000.`,
  '',
  mdTable(
    ['case', 'ops/s', 'Δ ops/s', 'p95 ms', 'p99 ms', 'Δ p99', 'ELU %', 'RSS MiB', 'alloc B/op'],
    [...extensionRows, wildcardComparison].map((row) => [
      row.name,
      Math.round(row.candidate.operationsPerSecond),
      `${row.throughputDeltaPct.toFixed(2)}%`,
      row.candidate.p95Ms.toFixed(6),
      row.candidate.p99Ms.toFixed(6),
      `${row.p99DeltaPct.toFixed(2)}%`,
      row.candidate.eluPct.toFixed(2),
      row.candidate.rssPeakMiB.toFixed(2),
      row.candidate.allocationBytesPerOperation.toFixed(2)
    ])
  ),
  '',
  'B2 extension rows use plain `swm` as reference; B7 uses `pino-sync` with the same wildcard path.',
  wildcardFailures.length === 0
    ? '**B7 competitive guard:** ✅ swm-log wins on paired throughput and p99'
    : `**B7 competitive guard:** ❌ ${wildcardFailures.length} failure(s)`,
  ''
].join('\n')

await appendStepSummary(markdown)

if (wildcardFailures.length > 0) {
  for (const failure of wildcardFailures) {
    console.error(`- ${failure}`)
  }

  process.exitCode = 1
}

function compareRows(
  name: string,
  candidate: BenchmarkMedianRow,
  reference: BenchmarkMedianRow,
  runs: BenchmarkRunRow[]
): {
  candidate: BenchmarkMedianRow
  name: string
  p99DeltaPct: number
  throughputDeltaPct: number
} {
  const comparison = compareBenchmarkRuns(
    runs.filter((row) => row.implementation === candidate.implementation),
    runs.filter((row) => row.implementation === reference.implementation)
  )

  return {
    candidate,
    name,
    p99DeltaPct: comparison.p99DeltaPct,
    throughputDeltaPct: comparison.throughputDeltaPct
  }
}
