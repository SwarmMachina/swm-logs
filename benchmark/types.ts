import type { ScenarioMeasurement } from '@swarmmachina/benchkit/measurement'

/** Stable scenario identifiers from the logger specification. */
export type ScenarioName = 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 'b6' | 'b7'

/** Implementations available to the isolated workers. */
export type ImplementationName =
  | 'swm'
  | 'swm-buffered'
  | 'swm-hook'
  | 'swm-formatter'
  | 'swm-transport'
  | 'swm-fanout-3'
  | 'pino-sync'
  | 'pino-async'
  | 'console-json'
  | 'pino'

/** One worker result before multi-run aggregation. */
export interface WorkerResult {
  scenario: ScenarioName
  implementation: ImplementationName
  measurement: ScenarioMeasurement
  sampledAllocationBytes: number
  allocationBytesPerOperation: number
}

/** One isolated run plus optional V8 profile paths. */
export interface BenchmarkRunRow extends WorkerResult {
  run: number
  v8Profile: { logPath: string; processedPath: string } | null
}

/** Median row used by reports and regression guards. */
export interface BenchmarkMedianRow {
  scenario: ScenarioName
  implementation: ImplementationName
  operations: number
  operationsPerSecond: number
  durationMs: number
  p95Ms: number
  p99Ms: number
  eluPct: number
  rssPeakMiB: number
  allocationBytesPerOperation: number
}

/** Versioned benchmark output written by the CLI. */
export interface LoggerBenchmarkResult {
  schemaVersion: 'swm-log-benchmark/v1'
  generatedAt: string
  node: string
  platform: string
  parameters: {
    runs: number
    warmup: number
    operations: number | null
    connections: 1
    pipelining: 1
    destination: 'null' | 'file'
    allocationSamplingIntervalBytes: number
    v8prof: boolean
  }
  runs: BenchmarkRunRow[]
  median: BenchmarkMedianRow[]
}
