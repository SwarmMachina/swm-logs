import { pairedComparison } from '@swarmmachina/benchkit/statistics'

import type { BenchmarkRunRow } from './types.js'

interface PairedBenchmarkComparison {
  p99DeltaPct: number
  p99Wins: number
  throughputDeltaPct: number
  throughputWins: number
}

function pairRows(
  candidate: readonly BenchmarkRunRow[],
  reference: readonly BenchmarkRunRow[]
): Array<[BenchmarkRunRow, BenchmarkRunRow]> {
  const references = new Map(reference.map((row) => [row.run, row]))

  return candidate.map((row) => {
    const paired = references.get(row.run)

    if (paired === undefined) {
      throw new Error(`missing reference benchmark row for run ${row.run}`)
    }

    return [row, paired]
  })
}

function compareBenchmarkRuns(
  candidate: readonly BenchmarkRunRow[],
  reference: readonly BenchmarkRunRow[]
): PairedBenchmarkComparison {
  const pairs = pairRows(candidate, reference)
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
    p99DeltaPct: p99.medianPairedDeltaPct,
    p99Wins: p99.winningPairs,
    throughputDeltaPct: throughput.medianPairedDeltaPct,
    throughputWins: throughput.winningPairs
  }
}

export { compareBenchmarkRuns }
export type { PairedBenchmarkComparison }
