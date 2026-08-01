import assert from 'node:assert/strict'
import { test } from 'node:test'

import { commaSeparatedValues, nonNegativeInteger, positiveInteger, requiredValue } from '../../benchmark/cli-values.ts'
import { compareBenchmarkRuns } from '../../benchmark/paired-benchmark-comparison.ts'
import type { BenchmarkRunRow } from '../../benchmark/types.ts'

function benchmarkRow(run: number, operationsPerSecond: number, p99: number): BenchmarkRunRow {
  return {
    measurement: { latencyMs: { p99 }, operationsPerSecond },
    run
  } as unknown as BenchmarkRunRow
}

test('benchmark CLI values share strict parsing rules', () => {
  assert.equal(requiredValue('output.json', 'output'), 'output.json')
  assert.deepEqual(commaSeparatedValues('swm, pino-sync'), ['swm', 'pino-sync'])
  assert.equal(positiveInteger('3', 'runs'), 3)
  assert.equal(nonNegativeInteger('0', 'warmup'), 0)

  assert.throws(() => requiredValue('', 'output'), /output is required/)
  assert.throws(() => positiveInteger('0', 'runs'), /positive integer/)
  assert.throws(() => nonNegativeInteger('-1', 'warmup'), /non-negative integer/)
})

test('benchmark comparison pairs rows by run', () => {
  const comparison = compareBenchmarkRuns(
    [benchmarkRow(1, 120, 1), benchmarkRow(2, 130, 0.9)],
    [benchmarkRow(2, 100, 1.1), benchmarkRow(1, 100, 1.2)]
  )

  assert.equal(comparison.throughputWins, 2)
  assert.equal(comparison.p99Wins, 2)
  assert.ok(comparison.throughputDeltaPct > 0)
  assert.ok(comparison.p99DeltaPct < 0)
  assert.throws(
    () => compareBenchmarkRuns([benchmarkRow(3, 100, 1)], [benchmarkRow(1, 100, 1)]),
    /missing reference benchmark row for run 3/
  )
})
