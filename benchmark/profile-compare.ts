import { pairedComparison } from '@swarmmachina/benchkit/statistics'
import { appendStepSummary, mdTable } from '@swarmmachina/benchkit/reporting'

import { runBenchmark } from './bench.js'
import type { BenchmarkRunRow, ScenarioName } from './types.js'

const runs = 4
const result = await runBenchmark({
  allocationSamplingIntervalBytes: 32_768,
  destination: 'null',
  operations: null,
  runs,
  scenarios: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
  v8prof: false,
  warmup: 1
})
const comparisons = (['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] as ScenarioName[]).map((scenario) => {
  const candidate = scenario === 'b5' ? 'swm-buffered' : 'swm'
  const reference = scenario === 'b5' ? 'pino-async' : scenario === 'b6' ? 'pino' : 'pino-sync'
  const pairs = pairRows(
    result.runs.filter((row) => row.scenario === scenario && row.implementation === candidate),
    result.runs.filter((row) => row.scenario === scenario && row.implementation === reference)
  )
  const throughput = pairedComparison(
    pairs.map(([left, right]) => ({
      candidate: left.measurement.operationsPerSecond,
      reference: right.measurement.operationsPerSecond
    })),
    { direction: 'higher' }
  )
  const p99 = pairedComparison(
    pairs.map(([left, right]) => ({
      candidate: left.measurement.latencyMs.p99 ?? 0,
      reference: right.measurement.latencyMs.p99 ?? 0
    })),
    { direction: 'lower' }
  )

  return {
    candidate,
    p99DeltaPct: p99.medianPairedDeltaPct,
    p99Wins: p99.winningPairs,
    reference,
    scenario,
    throughputDeltaPct: throughput.medianPairedDeltaPct,
    throughputWins: throughput.winningPairs
  }
})
const markdown = [
  '## swm-log balanced comparison',
  '',
  `Parameters: runs=${runs} (alternating AB/BA), warmup=1, connections=1, pipelining=1, duration=operation-bound, destination=/dev/null.`,
  '',
  mdTable(
    ['scenario', 'candidate', 'reference', 'ops/s Δ', 'ops wins', 'p99 Δ', 'p99 wins'],
    comparisons.map((row) => [
      row.scenario.toUpperCase(),
      row.candidate,
      row.reference,
      `${row.throughputDeltaPct.toFixed(2)}%`,
      `${row.throughputWins}/${runs}`,
      `${row.p99DeltaPct.toFixed(2)}%`,
      `${row.p99Wins}/${runs}`
    ])
  ),
  ''
].join('\n')

await appendStepSummary(markdown)

function pairRows(
  candidate: BenchmarkRunRow[],
  reference: BenchmarkRunRow[]
): Array<[BenchmarkRunRow, BenchmarkRunRow]> {
  const references = new Map(reference.map((row) => [row.run, row]))

  return candidate.map((row) => [row, references.get(row.run)!])
}
