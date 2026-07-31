import { closeSync, openSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { setImmediate as yieldEventLoop } from 'node:timers/promises'
import { writeFile } from 'node:fs/promises'
import { BoundedLatencyRecorder, measureScenario } from '@swarmmachina/benchkit/measurement'
import { parseArgs } from '@swarmmachina/benchkit/orchestration'
import { sampleV8HeapAllocations } from '@swarmmachina/benchkit/profiling'

import type { ImplementationName, ScenarioName, WorkerResult } from '../types.js'
import { ScenarioLogger, type BenchLogger } from './scenario-logger.js'

interface WorkerArgs {
  scenario: ScenarioName
  implementation: ImplementationName
  operations: number
  warmup: number
  output: string
  result: string
  allocationSamplingIntervalBytes: number
}

const args = parseWorkerArgs(process.argv)
const outputFd = openSync(args.output, 'w')

try {
  const scenarioLogger = new ScenarioLogger(args.implementation, outputFd, args.scenario)
  const operation = makeOperation(args.scenario, scenarioLogger.logger)
  const warmupOperations = Math.min(args.operations, 10_000)

  for (let pass = 0; pass < args.warmup; pass += 1) {
    runOperations(operation, warmupOperations)
    scenarioLogger.flush()
  }

  const sampled = await sampleV8HeapAllocations(
    () =>
      measureScenario({
        name: `${args.scenario}/${args.implementation}`,
        connections: 1,
        pipelining: 1,
        operations: args.operations,
        memorySampleMs: 50,
        async run() {
          await yieldEventLoop()
          const latency = runOperations(operation, args.operations)

          scenarioLogger.flush()
          await yieldEventLoop()

          return latency.snapshot()
        }
      }),
    { samplingIntervalBytes: args.allocationSamplingIntervalBytes }
  )
  const result: WorkerResult = {
    allocationBytesPerOperation: sampled.sampledAllocationBytes / args.operations,
    implementation: args.implementation,
    measurement: sampled.value,
    sampledAllocationBytes: sampled.sampledAllocationBytes,
    scenario: args.scenario
  }

  await writeFile(args.result, `${JSON.stringify(result)}\n`)
} finally {
  closeSync(outputFd)
}

function parseWorkerArgs(argv: string[]): WorkerArgs {
  return parseArgs(
    argv,
    {
      allocationSamplingIntervalBytes: 32_768,
      implementation: 'swm' as ImplementationName,
      operations: 100_000,
      output: '',
      result: '',
      scenario: 'b1' as ScenarioName,
      warmup: 1
    },
    {
      '--allocation-sampling-interval': (out, value) => {
        out.allocationSamplingIntervalBytes = positiveInteger(value, 'allocation sampling interval')
      },
      '--implementation': (out, value) => {
        out.implementation = value as ImplementationName
      },
      '--operations': (out, value) => {
        out.operations = positiveInteger(value, 'operations')
      },
      '--output': (out, value) => {
        out.output = required(value, 'output')
      },
      '--result': (out, value) => {
        out.result = required(value, 'result')
      },
      '--scenario': (out, value) => {
        out.scenario = value as ScenarioName
      },
      '--warmup': (out, value) => {
        out.warmup = nonNegativeInteger(value, 'warmup')
      }
    },
    { offset: 2, strict: true }
  )
}

/** Chooses a scenario once so the measured call does not branch on every operation. */
function makeOperation(scenario: ScenarioName, logger: BenchLogger): (index: number) => void {
  if (scenario === 'b1') {
    return () => logger.info('msg')
  }

  if (scenario === 'b2') {
    return () => logger.info({ a: 1, b: 'x', c: true }, 'msg')
  }

  if (scenario === 'b3') {
    const child = logger.child?.({ component: 'gateway', node: 'a', transport: 'ws' }) ?? logger

    return (index) => child.info({ a: 1, b: 'x', c: true, requestId: index, ok: true }, 'msg')
  }

  if (scenario === 'b4') {
    const cause = new Error('database unavailable')
    const error = new Error('request failed', { cause })

    return () => logger.error(error)
  }

  if (scenario === 'b5') {
    return (index) => logger.info({ index }, 'buffered')
  }

  if (scenario === 'b7') {
    return (index) =>
      logger.info(
        {
          requestId: index,
          users: [
            { id: 1, password: 'first-secret' },
            { id: 2, password: 'second-secret' },
            { id: 3, password: 'third-secret' }
          ]
        },
        'redacted'
      )
  }

  throw new TypeError(`scenario ${scenario} is not a hot-path worker scenario`)
}

function runOperations(operation: (index: number) => void, operations: number): BoundedLatencyRecorder {
  const latency = new BoundedLatencyRecorder({
    highestTrackableMs: 60_000,
    lowestDiscernibleMs: 0.000_1,
    relativeAccuracy: 0.01
  })

  for (let index = 0; index < operations; index += 1) {
    const startedAt = performance.now()

    operation(index)
    latency.record(performance.now() - startedAt)
  }

  return latency
}

function required(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) {
    throw new TypeError(`${label} is required`)
  }

  return value
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
