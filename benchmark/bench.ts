import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from '@swarmmachina/benchkit/orchestration'
import { appendStepSummary, mdTable } from '@swarmmachina/benchkit/reporting'

import { BenchmarkRunner, type BenchmarkRunnerOptions } from './benchmark-runner.js'
import type { ImplementationName, LoggerBenchmarkResult, ScenarioName } from './types.js'

interface CliOptions extends BenchmarkRunnerOptions {
  jsonOut: string | null
}

/** Runs the benchmark and guarantees temporary-file cleanup. */
export async function runBenchmark(options: BenchmarkRunnerOptions): Promise<LoggerBenchmarkResult> {
  const runner = new BenchmarkRunner(options)

  try {
    return await runner.run()
  } finally {
    await runner.close()
  }
}

/** Renders the stable console/GitHub summary table. */
export function renderBenchmark(result: LoggerBenchmarkResult): string {
  const parameters = [
    `runs=${result.parameters.runs}`,
    `warmup=${result.parameters.warmup}`,
    `connections=${result.parameters.connections}`,
    `pipelining=${result.parameters.pipelining}`,
    `duration=operation-bound (reported per row)`,
    `destination=${result.parameters.destination}`,
    `allocation-sampling=${result.parameters.allocationSamplingIntervalBytes}B`
  ].join(', ')
  const table = mdTable(
    ['scenario', 'implementation', 'ops', 'ops/s', 'total ms', 'p95 ms', 'p99 ms', 'ELU %', 'RSS MiB', 'alloc B/op'],
    result.median.map((row) => [
      row.scenario.toUpperCase(),
      row.implementation,
      row.operations,
      Math.round(row.operationsPerSecond),
      row.durationMs.toFixed(2),
      row.p95Ms.toFixed(6),
      row.p99Ms.toFixed(6),
      row.eluPct.toFixed(2),
      row.rssPeakMiB.toFixed(2),
      row.allocationBytesPerOperation.toFixed(2)
    ])
  )

  return `## swm-log benchmark\n\nParameters: ${parameters}\n\n${table}\n`
}

function parseCli(argv: string[]): CliOptions {
  return parseArgs(
    argv,
    {
      allocationSamplingIntervalBytes: 32_768,
      destination: 'null' as 'null' | 'file',
      implementations: undefined as ImplementationName[] | undefined,
      jsonOut: null as string | null,
      operations: null as number | null,
      runs: 3,
      scenarios: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'] as ScenarioName[],
      v8prof: false as boolean,
      warmup: 1
    },
    {
      '--allocation-sampling-interval': (out, value) => {
        out.allocationSamplingIntervalBytes = positiveInteger(value, 'allocation sampling interval')
      },
      '--destination': (out, value) => {
        if (value !== 'null' && value !== 'file') {
          throw new TypeError('destination must be null or file')
        }

        out.destination = value
      },
      '--implementations': (out, value) => {
        out.implementations = splitList(value) as ImplementationName[]
      },
      '--json-out': (out, value) => {
        out.jsonOut = value ?? null
      },
      '--operations': (out, value) => {
        out.operations = positiveInteger(value, 'operations')
      },
      '--runs': (out, value) => {
        out.runs = positiveInteger(value, 'runs')
      },
      '--scenario': (out, value) => {
        out.scenarios =
          value === 'all' ? ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'] : (splitList(value) as ScenarioName[])
      },
      '--v8prof': (out, value) => {
        out.v8prof = value === 'true'
      },
      '--warmup': (out, value) => {
        out.warmup = nonNegativeInteger(value, 'warmup')
      }
    },
    { offset: 2, strict: true }
  )
}

function splitList(value: string | undefined): string[] {
  if (value === undefined || value.length === 0) {
    throw new TypeError('list value is required')
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function positiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer`)
  }

  return parsed
}

function nonNegativeInteger(value: string | undefined, label: string): number {
  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a non-negative integer`)
  }

  return parsed
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const cli = parseCli(process.argv)
  const result = await runBenchmark(cli)
  const markdown = renderBenchmark(result)

  await appendStepSummary(markdown)

  if (cli.jsonOut !== null) {
    await writeFile(cli.jsonOut, `${JSON.stringify(result, null, 2)}\n`)
  }
}
