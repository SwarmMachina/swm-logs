import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { validateBaseline } from '@swarmmachina/benchkit/regression'
import { metricGuard } from '@swarmmachina/benchkit/regression'
import { appendStepSummary, mdTable } from '@swarmmachina/benchkit/reporting'

import { runBenchmark } from './bench.js'
import { writeBenchmarkProfile } from './profile-output.js'
import type { LoggerBenchmarkResult, ScenarioName } from './types.js'

interface LoggerBaselineTest {
  guards: Record<string, { min?: number; max?: number }>
}

interface LoggerBaseline {
  tests: Record<ScenarioName, LoggerBaselineTest>
}

const baselinePath = fileURLToPath(new URL('./baselines/logger.json', import.meta.url))
const baselineJson: unknown = JSON.parse(await readFile(baselinePath, 'utf8'))
const validation = validateBaseline(baselineJson)

if (!validation.ok) {
  throw new Error(`invalid benchmark baseline: ${validation.errors.join('; ')}`)
}

const baseline = baselineJson as typeof baselineJson & LoggerBaseline
const common = {
  allocationSamplingIntervalBytes: 32_768,
  destination: 'null' as const,
  operations: null,
  runs: positiveEnvironmentInteger('PROFILE_RUNS', 3),
  v8prof: process.env.PROFILE_V8PROF === 'true',
  warmup: positiveEnvironmentInteger('PROFILE_WARMUP', 1)
}
const immediate = await runBenchmark({
  ...common,
  implementations: ['swm'],
  scenarios: ['b1', 'b2', 'b3', 'b4']
})
const buffered = await runBenchmark({ ...common, implementations: ['swm-buffered'], scenarios: ['b5'] })
const wildcard = await runBenchmark({ ...common, implementations: ['swm'], scenarios: ['b7'] })
const result = mergeResults(immediate, buffered, wildcard)
const cases = result.median.map((row) => row.scenario)
const measurements = Object.fromEntries(
  result.median.map((row) => [
    row.scenario,
    {
      allocationBytesPerOperation: row.allocationBytesPerOperation,
      operationsPerSecond: row.operationsPerSecond,
      p99Ms: row.p99Ms,
      rssPeakMiB: row.rssPeakMiB
    }
  ])
)
const guard = metricGuard({ cases, results: measurements, baselineTests: baseline.tests })
const markdown = [
  '## swm-log regression profile',
  '',
  `Parameters: runs=${common.runs}, warmup=${common.warmup}, connections=1, pipelining=1, duration=operation-bound, destination=/dev/null, V8 profiles=${common.v8prof}.`,
  '',
  mdTable(
    ['case', 'metric', 'value', 'min', 'max', 'status'],
    guard.rows.map((row) => [
      row.case,
      row.metric,
      row.value?.toFixed(3) ?? 'missing',
      row.min ?? '—',
      row.max ?? '—',
      row.status === 'ok' ? '✅' : '❌'
    ])
  ),
  '',
  guard.failures.length === 0
    ? '**Result:** ✅ all guards passed'
    : `**Result:** ❌ ${guard.failures.length} failure(s)`,
  ''
].join('\n')

await writeBenchmarkProfile('regression.json', {
  baseline: baselineJson,
  guard: {
    failures: guard.failures,
    rows: guard.rows
  },
  result
})
await appendStepSummary(markdown)

if (process.env.GITHUB_ACTIONS === 'true') {
  console.log(markdown)
}

if (guard.failures.length > 0) {
  for (const failure of guard.failures) {
    console.error(`- ${failure}`)
  }

  process.exitCode = 1
}

function mergeResults(first: LoggerBenchmarkResult, ...remaining: LoggerBenchmarkResult[]): LoggerBenchmarkResult {
  return {
    ...first,
    median: [...first.median, ...remaining.flatMap((result) => result.median)],
    runs: [...first.runs, ...remaining.flatMap((result) => result.runs)]
  }
}

function positiveEnvironmentInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name])

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}
