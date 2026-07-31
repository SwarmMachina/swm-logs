import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { balancedSchedule, ensureDir, runChild } from '@swarmmachina/benchkit/orchestration'
import { processV8Profile } from '@swarmmachina/benchkit/profiling'
import { median } from '@swarmmachina/benchkit/statistics'

import type {
  BenchmarkMedianRow,
  BenchmarkRunRow,
  ImplementationName,
  LoggerBenchmarkResult,
  ScenarioName,
  WorkerResult
} from './types.js'

/** Options for one isolated multi-process benchmark suite. */
export interface BenchmarkRunnerOptions {
  scenarios: ScenarioName[]
  implementations?: ImplementationName[]
  runs: number
  warmup: number
  operations: number | null
  destination: 'null' | 'file'
  allocationSamplingIntervalBytes: number
  v8prof: boolean
}

const BENCHMARK_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = dirname(BENCHMARK_DIR)
const DEFAULT_OPERATIONS: Readonly<Record<ScenarioName, number>> = Object.freeze({
  b1: 200_000,
  b2: 150_000,
  b3: 120_000,
  b4: 50_000,
  b5: 1_000_000,
  b6: 1,
  b7: 80_000
})
const DEFAULT_IMPLEMENTATIONS: Readonly<Record<ScenarioName, ImplementationName[]>> = Object.freeze({
  b1: ['swm', 'pino-sync', 'console-json'],
  b2: ['swm', 'pino-sync', 'console-json'],
  b3: ['swm', 'pino-sync', 'console-json'],
  b4: ['swm', 'pino-sync', 'console-json'],
  b5: ['swm-buffered', 'pino-async'],
  b6: ['swm', 'pino'],
  b7: ['swm', 'pino-sync']
})

/** Owns temporary files and sequential child-process benchmark orchestration. */
export class BenchmarkRunner {
  readonly #options: BenchmarkRunnerOptions
  #sequence = 0
  #temporaryDirectory: string | null = null

  constructor(options: BenchmarkRunnerOptions) {
    this.#options = options
  }

  /** Runs all configured scenarios and returns individual and median rows. */
  async run(): Promise<LoggerBenchmarkResult> {
    this.#temporaryDirectory = await mkdtemp(join(tmpdir(), 'swm-log-benchmark-'))
    const rows: BenchmarkRunRow[] = []

    for (const scenario of this.#options.scenarios) {
      const implementations = this.#implementationsFor(scenario)

      if (scenario === 'b6') {
        for (let pass = 0; pass < this.#options.warmup; pass += 1) {
          for (const implementation of implementations) {
            await this.#runWorker(scenario, implementation, 0, true)
          }
        }
      }

      const schedule = balancedOrder(implementations, this.#options.runs)

      for (let run = 1; run <= this.#options.runs; run += 1) {
        for (const implementation of schedule[run - 1]!) {
          rows.push(await this.#runWorker(scenario, implementation, run, false))
        }
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      median: aggregateMedians(rows),
      node: process.version,
      parameters: {
        allocationSamplingIntervalBytes: this.#options.allocationSamplingIntervalBytes,
        connections: 1,
        destination: this.#options.destination,
        operations: this.#options.operations,
        pipelining: 1,
        runs: this.#options.runs,
        v8prof: this.#options.v8prof,
        warmup: this.#options.warmup
      },
      platform: `${process.platform}/${process.arch}`,
      runs: rows,
      schemaVersion: 'swm-log-benchmark/v1'
    }
  }

  /** Removes only the temporary directory created by this runner. */
  async close(): Promise<void> {
    if (this.#temporaryDirectory === null) {
      return
    }

    const target = this.#temporaryDirectory

    this.#temporaryDirectory = null
    await rm(target, { force: true, recursive: true })
  }

  #implementationsFor(scenario: ScenarioName): ImplementationName[] {
    const implementations = this.#options.implementations ?? DEFAULT_IMPLEMENTATIONS[scenario]

    if (scenario === 'b6' && implementations.some((name) => name !== 'swm' && name !== 'pino')) {
      throw new TypeError('B6 supports only swm and pino implementations')
    }

    return [...implementations]
  }

  async #runWorker(
    scenario: ScenarioName,
    implementation: ImplementationName,
    run: number,
    discard: boolean
  ): Promise<BenchmarkRunRow> {
    const sequence = this.#sequence++
    const resultPath = join(this.#temporaryDirectory!, `result-${sequence}.json`)
    const outputPath =
      this.#options.destination === 'null'
        ? process.platform === 'win32'
          ? 'NUL'
          : '/dev/null'
        : join(this.#temporaryDirectory!, `output-${sequence}.ndjson`)
    const worker = join(BENCHMARK_DIR, 'suites', scenario === 'b6' ? 'cold-worker.js' : 'scenario-worker.js')
    const workerArgs = [
      worker,
      '--implementation',
      implementation,
      '--result',
      resultPath,
      '--allocation-sampling-interval',
      String(this.#options.allocationSamplingIntervalBytes)
    ]

    if (scenario !== 'b6') {
      workerArgs.push(
        '--scenario',
        scenario,
        '--operations',
        String(this.#options.operations ?? DEFAULT_OPERATIONS[scenario]),
        '--warmup',
        String(this.#options.warmup),
        '--output',
        outputPath
      )
    }

    let profile: BenchmarkRunRow['v8Profile'] = null

    if (this.#options.v8prof && !discard) {
      const profileDirectory = join(BENCHMARK_DIR, 'profiles', `${scenario}-${implementation}-run-${run}`)

      await ensureDir(profileDirectory)
      await runChild(['--prof', `--logfile=${join(profileDirectory, 'isolate-%p-v8.log')}`, ...workerArgs], {
        cwd: REPO_ROOT
      })
      profile = await processV8Profile(profileDirectory)
    } else {
      await runChild(workerArgs, { cwd: REPO_ROOT })
    }

    const result = JSON.parse(await readFile(resultPath, 'utf8')) as WorkerResult

    return { ...result, run, v8Profile: profile }
  }
}

function balancedOrder(implementations: ImplementationName[], runs: number): ImplementationName[][] {
  if (implementations.length < 2) {
    return Array.from({ length: runs }, () => [...implementations])
  }

  const [candidate, reference, ...remaining] = implementations
  const schedule = balancedSchedule({
    candidate: candidate!,
    reference: reference!,
    runs,
    strictBalance: false
  })

  return schedule.map(({ order }) => [...order, ...remaining])
}

function aggregateMedians(rows: BenchmarkRunRow[]): BenchmarkMedianRow[] {
  const groups = new Map<string, BenchmarkRunRow[]>()

  for (const row of rows) {
    const key = `${row.scenario}/${row.implementation}`

    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  return [...groups.values()].map((group) => {
    const first = group[0]!

    return {
      allocationBytesPerOperation: median(group.map((row) => row.allocationBytesPerOperation)),
      durationMs: median(group.map((row) => row.measurement.durationMs)),
      eluPct: median(group.map((row) => row.measurement.eluPct)),
      implementation: first.implementation,
      operations: first.measurement.operations,
      operationsPerSecond: median(group.map((row) => row.measurement.operationsPerSecond)),
      p95Ms: nullableMedian(group.map((row) => row.measurement.latencyMs.p95)),
      p99Ms: nullableMedian(group.map((row) => row.measurement.latencyMs.p99)),
      rssPeakMiB: nullableMedian(
        group.map((row) => {
          const peak = row.measurement.processMemory?.rss.peakBytes

          return peak === undefined ? null : peak / (1024 * 1024)
        })
      ),
      scenario: first.scenario
    }
  })
}

function nullableMedian(values: Array<number | null>): number {
  const finite = values.filter((value): value is number => Number.isFinite(value))

  return finite.length === 0 ? 0 : median(finite)
}
