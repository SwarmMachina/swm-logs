# @swarmmachina/swm-log

[![License: MPL 2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0)
[![Node.js Version](https://img.shields.io/badge/node-22.x%20%7C%2024.x-brightgreen)](https://nodejs.org/)
[![dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen.svg)](#runtime-design)
[![stability](https://img.shields.io/badge/stability-experimental-yellow.svg)](#stability)

A zero-runtime-dependency structured JSON logger for Node.js. It emits pino-compatible numeric levels and NDJSON directly to stdout, stderr, a file descriptor, or a writable destination.

## Features

- Pino-compatible levels: `trace=10` through `fatal=60`, plus custom levels
- Deterministic `level`, `time`, `msg`, bindings, and fields envelope
- Child bindings serialized once during `child()` construction
- Manual primitive fast path; circular and BigInt-safe nested serialization
- Recursive Error `cause` serialization with a finite depth limit
- Compiled redact paths that inspect only configured branches
- Keyed serializers and bounded nested serialization
- Immediate output by default; bounded opt-in buffering with `flushSync()`
- Opt-in structured hooks, custom formatters, and fire-and-forget transport fan-out
- Observable destination failures with shared loss counters
- Opt-in, reversible `console.*` bridge
- Native ESM and TypeScript declarations on Node.js 22 and 24

## Installation

```bash
pnpm add @swarmmachina/swm-log
```

### Runtime requirements

- Node.js `22.x` or `24.x`; other majors are rejected by the package engine constraint.
- Native ESM. CommonJS `require()` is not a supported package surface.
- No runtime dependencies, bundled transports, workers, or hidden background threads. External transport modules own those resources.

## Quick start2

<!-- example:test quick-start -->

```js
import Logger from '@swarmmachina/swm-log'

const logger = new Logger({ bindings: { service: 'gateway' } })

logger.info({ port: 3000 }, 'listening')
logger.error(new Error('request failed'))
```

The first call emits one line shaped like this:

```json
{ "level": 30, "time": 1710000000000, "msg": "listening", "service": "gateway", "port": 3000 }
```

`time` is Unix epoch milliseconds. Every output record ends with exactly one newline. The order is stable: envelope, pre-serialized bindings, then call fields. `level`, `time`, and `msg` in bindings or fields are ignored so application data cannot spoof the envelope.

## Child request loggers

A connection/request hook should create one child and reuse it for that lifecycle. This is the intended integration shape for `swm-core`:

<!-- example:test child-hook -->

```js
import Logger from '@swarmmachina/swm-log'

const rootLogger = new Logger({ bindings: { service: 'realtime-api' } })

export function requestLogger(connection) {
  return rootLogger.child({
    connectionId: connection.id,
    remoteAddress: connection.remoteAddress
  })
}
```

Bindings are serialized when `child()` runs. Mutating a nested binding later does not change subsequent output. Children share the root destination and optional buffer; calling `close()` on any related logger closes that shared writer.

## Log calls

Every built-in or custom level accepts the same shapes:

```ts
logger.info('message')
logger.info({ requestId: 'r1', ok: true }, 'message')
logger.error(error)
logger.error({ err: error, requestId: 'r1' }, 'message')
logger.info('user %s has %d jobs', 'Ada', 3)
```

Enabled methods return `void`. `fatal()` logs at severity 60 and does not exit the process.

### Levels

| Name    | Value |
| ------- | ----: |
| `trace` |    10 |
| `debug` |    20 |
| `info`  |    30 |
| `warn`  |    40 |
| `error` |    50 |
| `fatal` |    60 |

Configure a threshold with `level`, change it through `logger.level`, and check it with `logger.isLevelEnabled(name)`. `silent` disables all output.

Custom levels use the explicit `logger.log(name, ...)` method. The logger does not install per-instance methods or allocate closures for them.

```ts
import Logger from '@swarmmachina/swm-log'

const customLevels = { notice: 35 } as const
const logger = new Logger({ customLevels, level: 'trace' })

logger.log('notice', 'deployed')
```

## Serialization and redaction

Primitive fields take the manual fast path. Nested objects use safe `JSON.stringify()` behavior with these extensions:

- circular ancestor references become `"[Circular]"`;
- BigInt values become decimal strings;
- `undefined`, function, symbol values, and symbol keys are omitted;
- non-finite numbers become `null`;
- `err` values include `type`, `message`, `stack`, recursive `cause`, and enumerable custom properties.

The default Error depth is five objects. Configure `errorCauseDepth` with a positive integer. General nested serialization defaults to `depthLimit: 5` and `edgeLimit: 100`; deeper containers become `[Object]`/`[Array]`, while excess edges are represented by a finite marker.

Top-level serializers run only for matching keys. Bindings are serialized once during root/child construction; call-field serializers run once per enabled log call.

<!-- example:test serializers -->

```js
import Logger from '@swarmmachina/swm-log'

const logger = new Logger({
  serializers: {
    account: (account) => ({ id: account.id })
  }
})

logger.info({ account: { id: 7, accessToken: 'secret' } }, 'signed in')
```

A single redact path is compiled into a closure chain and fused with bounded JSON serialization, so the default output path neither mutates nor clones caller data. Multiple and overlapping paths use the general branch-trie fallback, which clones only matched containers. Dot notation, quoted/numeric bracket notation, `*`, and `[*]` are supported. Rich configuration adds a static/function `censor` or `remove: true`.

<!-- example:test redact -->

```js
import Logger from '@swarmmachina/swm-log'

const logger = new Logger({ redact: ['req.headers.authorization', 'user.password'] })

logger.info(
  {
    req: { headers: { authorization: 'Bearer secret' } },
    user: { id: 7, password: 'secret' }
  },
  'request'
)
```

For arrays, use a wildcard such as `users[*].password`. Wildcard cost grows with the number of keys/elements at the matched level; prefer exact paths where the schema is known.

Serialization, time, hook, formatter, and destination failures never escape a log method. A processing failure becomes a valid record with `logger_error`. Invalid constructor or `child()` configuration throws an explanatory `TypeError`.

## Hooks, formatters, and transports

The extension flow is explicit:

`log arguments → prepared record → beforeFormat hooks → formatter → afterFormat hooks → console + transports`

When `hooks` and `formatter` are both absent, the logger retains the direct manual JSON fast path: it does not allocate a `LogRecord`, build callback arrays, or perform virtual hook calls. Enabling either option selects the structured extension path for that root and its children.

- `beforeFormat` receives an owned record whose bindings are snapshotted and whose fields have already passed redact and keyed serializers. It may mutate top-level record state or return `false` to drop the record. Values introduced by a trusted hook are not run through redact/serializers a second time.
- `formatter` converts that record to a string. The logger adds `\n` when absent; a non-JSON formatter intentionally leaves the pino-compatible NDJSON surface.
- `afterFormat` observes/replaces the string or returns `false` to drop it.
- Every configured transport receives the final string plus numeric severity and owns its queue, worker, routing, retry, timeout, and failure policy.

<!-- example:test extensions -->

```js
import Logger from '@swarmmachina/swm-log'

class AsyncTransport {
  #pending = Promise.resolve()
  #send

  constructor(send) {
    this.#send = send
  }

  write(line, level) {
    this.#pending = this.#pending.then(() => this.#send(line, level)).catch(() => {})
  }

  flush() {
    return this.#pending
  }

  close() {
    return this.flush()
  }
}

const wal = new AsyncTransport(async (_line, _level) => {})
const database = new AsyncTransport(async (_line, _level) => {})
const http = new AsyncTransport(async (_line, _level) => {})

const logger = new Logger({
  console: false,
  hooks: {
    beforeFormat(record) {
      record.fields.service = 'gateway'
    }
  },
  transports: [wal, database, http]
})

logger.info('listening')
await logger.close()
```

`console` defaults to `true`, so configured transports normally receive the same record in addition to stdout or `destination`. Set `console: false` for transport-only delivery. This requires at least one transport; use `level: 'silent'` when the whole logger should be disabled. Core `buffering` applies only to console output.

`LogTransport.write()` is fire-and-forget: core invokes it but never awaits work. It must only accept/enqueue and return quickly. A transport that performs blocking I/O inside `write()` violates the contract and will block the event loop; core deliberately does not hide that behind another queue. Asynchronous failures, retry, batching, backpressure, and drop metrics belong to each transport. A synchronous throw is contained so one broken transport does not prevent later transports from receiving the record.

`flush()` and `close()` coordinate all transport lifecycles concurrently and may be awaited. `flushSync()` invokes only synchronous capabilities exposed by the transports. Multistream routing, worker delivery, pretty printing, file rotation, WAL, database, HTTP, backoff, and vendor exporters belong in separate modules implementing `LogTransport`.

## Output and shutdown

Immediate mode calls `process.stdout.write(line)` by default. It does not add a transport queue. When a Node.js stream returns `false`, logging continues and the stream/runtime owns the queued bytes; `false` is backpressure, not a counted delivery failure. A slow pipe can therefore grow the stream's own pending memory.

stdout backed by a regular file is synchronous on supported Node.js platforms; the crash test writes 10,000 records and immediately calls `process.exit()`. Piped stdout may be asynchronous. When crash durability is mandatory, redirect to a regular file or pass its numeric descriptor.

### Buffered mode

<!-- example:test buffered -->

```js
import Logger from '@swarmmachina/swm-log'

const logger = new Logger({
  buffering: { maxBytes: 64 * 1024, flushInterval: 1000, flushLevel: 'warn' }
})

logger.info('batched')
logger.warn('flushes the whole buffer')

process.once('beforeExit', () => logger.flushSync())
```

The console buffer flushes at `maxBytes`, on the unref'ed timer, or at `flushLevel` and above. Transports still receive every record immediately through their own fire-and-forget boundary. The console buffer is reset even if the destination fails, preserving the logger's memory bound. A single oversized line may temporarily exceed the bound. `flushSync()` uses `fs.writeSync()` when stdout/stderr or a numeric descriptor is available; a generic custom writer can only receive a normal `write()` call.

Contained delivery failures increment `destinationErrors`, `droppedChunks`, `droppedRecords`, and `droppedBytes`. Read a detached snapshot through `logger.deliveryStats()` and optionally install `onDestinationError`. The observer is synchronous, no-throw, and reentrancy-guarded; it must not be used as the primary delivery path.

Call `await logger.close()` during graceful shutdown; synchronous writers return immediately while transports may finish concurrently. Use `flushSync()` only for console output and transports that explicitly provide a synchronous crash path.

## Console bridge

`ConsoleBridge` is separate and opt-in. Installation and restoration are explicit lifecycle transitions.

<!-- example:test console-bridge -->

```js
import Logger, { ConsoleBridge } from '@swarmmachina/swm-log'

const logger = new Logger()
const bridge = new ConsoleBridge(logger).install()

console.log('structured now')
bridge.restore()
```

`trace`, `debug`, `log`, `info`, `warn`, and `error` map to their corresponding logger levels (`console.log` maps to `info`).

## Migrating from pino

The output works with NDJSON pipelines such as Loki, Vector, pino-pretty, and parsers that recognize pino numeric levels.

| pino                                      | swm-log                                     |
| ----------------------------------------- | ------------------------------------------- |
| `pino({ level })`                         | `new Logger({ level })`                     |
| `base`                                    | `bindings`                                  |
| `customLevels`                            | `customLevels`                              |
| redact path list                          | `redact` path list                          |
| `timestamp` fragment function             | `time` returning epoch-ms number            |
| `pino.destination({ sync: true })`        | immediate mode (default)                    |
| async SonicBoom destination               | `buffering: true`                           |
| transports / worker-thread pretty printer | `transports[]`; implementations not bundled |
| custom serializers                        | keyed `serializers` plus built-in `err`     |
| hooks / formatters                        | opt-in compiled extension pipeline          |

Default pino places object fields before `msg`; swm-log follows its documented stable envelope with `msg` first. The compatibility snapshots configure pino's `logMethod` hook to the same field order and compare complete bytes.

## Performance guidance

Use immediate mode when crash visibility and predictable delivery are more important than peak throughput. Use buffered mode for very high-volume logs, then wire `flushSync()` into fatal/exit handling. Do not enable buffering merely to save a few microseconds: it adds a bounded userspace queue and a delivery lifecycle your application must own.

Local calibration (`darwin/arm64`, Node 24.17.0, benchkit 0.2.0, `/dev/null`, three isolated runs, one warmup, sampled allocations at 32 KiB) produced:

| Scenario                   | swm-log ops/s | pino ops/s | swm p99 ms | pino p99 ms |
| -------------------------- | ------------: | ---------: | ---------: | ----------: |
| B1 message                 |     1,286,729 |    991,776 |   0.001681 |    0.001931 |
| B2 flat fields             |     1,027,411 |    863,262 |   0.001969 |    0.002090 |
| B3 child + fields          |       868,232 |    806,369 |   0.002218 |    0.002308 |
| B4 Error + cause           |       399,073 |    401,453 |   0.004180 |    0.004017 |
| B5 buffered                |     2,931,908 |    543,483 |   0.001200 |    0.003639 |
| B6 cold ESM import (total) |       2.58 ms |    5.95 ms |          — |           — |
| B7 wildcard redact         |       690,550 |    546,418 |   0.003106 |    0.003296 |

The separate balanced extension profile (`B2`, four AB/BA runs, 150,000 operations) measured the opt-in cost against the same default swm-log build:

| Extension        |     ops/s | throughput delta |   p99 ms | p99 delta | allocations B/op |
| ---------------- | --------: | ---------------: | -------: | --------: | ---------------: |
| no-op hook       |   902,694 |          -13.38% | 0.002308 |   +19.51% |         2,023.81 |
| formatter        |   906,042 |          -13.30% | 0.002218 |   +14.89% |         1,279.81 |
| one transport    | 1,064,154 |           +1.95% | 0.001893 |     0.00% |         1,496.81 |
| three transports | 1,057,999 |           +0.98% | 0.001893 |    -3.86% |         1,560.26 |

The one- and three-transport deltas are within run noise and show no measurable default-path penalty. The three-transport case writes once to `/dev/null` and invokes two additional non-blocking acceptors, isolating fan-out overhead from transport I/O. Structured hooks/formatters pay for one owned record and one merged fields object only when enabled. B7 is intentionally isolated: the fused immutable wildcard path was 27.71% faster than pino-sync in this balanced AB/BA profile, with 10.31% lower paired p99.

These are host-specific measurements, not portable promises. B6 uses cold `import()` because both packages are consumed as ESM. Run the suite on the deployment class instead of copying these numbers:

```bash
pnpm bench
pnpm bench:b1
pnpm bench:b7
pnpm profile:compare
pnpm profile:ci
pnpm profile:extensions
```

The harness fixes `connections=1`, `pipelining=1`, uses operation-bound duration (reported per row), isolates every run in a child process, alternates AB/BA, reports median ops/s, p95/p99, ELU, RSS, and sampled allocations/op, and can process V8 profiles with `--v8prof true`. File end-to-end cost is available with `--destination file`.

Committed baselines live in `benchmark/baselines/`; B7 has both an absolute regression floor and a relative competitive guard against pino-sync. Latency ceilings include observed scheduler jitter. Recalibrate before moving the regression gate to another runner class.

## Testing and release gate

```bash
pnpm check
pnpm test
pnpm test:e2e
pnpm test:leak
pnpm release:gate
```

Tests cover pino byte snapshots, Error cause depth/cycles, BigInt and symbols, bounded serialization, serializers, exact/wildcard redact, extension failures, multi-transport fan-out and lifecycle, delivery counters, timer/size/severity flushing, console restoration, packed TypeScript resolution, and the 10,000-line immediate-exit contract. Marked README examples are extracted and executed by the e2e suite.

## Runtime design

- `Logger` owns only per-instance bindings/filter state and composes the shared components below.
- `LevelRegistry` owns validated immutable level lookup tables.
- Argument/message normalization remains a pure function.
- `FieldSerializer` owns field/redact/serializer configuration and is shared by children.
- `Redactor` owns the compiled single-path or trie strategy without mutating caller data.
- `OutputDestination` owns one stdout/stderr/fd/writer target.
- `ExtensionPipeline` exists only for a logger configured with hooks or a formatter.
- `OutputPipeline` owns console/transport fan-out and their shared lifecycle.
- `DeliveryMonitor` owns reentrancy-safe failure notification and shared counters.
- `BufferedWriter` owns the opt-in console queue; `OutputPipeline` handles immediate delivery directly.
- `ConsoleBridge` owns installation and restoration of global console methods.
- Redact-path parsing and normal/fused JSON stringifiers remain pure functions.
- Runtime dependency count is zero.

## Stability

The package is experimental at `0.x`. The NDJSON envelope and numeric levels are intended to stabilize first; benchmark baselines remain runner-specific.

## License

Mozilla Public License 2.0. See [LICENSE](./LICENSE).
