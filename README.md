# @swarmmachina/swm-logs

[![CI](https://github.com/SwarmMachina/swm-logs/actions/workflows/ci.yml/badge.svg)](https://github.com/SwarmMachina/swm-logs/actions/workflows/ci.yml)
[![License: MPL 2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0)
[![Node.js](https://img.shields.io/badge/node-22%20%7C%2024-brightgreen.svg)](https://nodejs.org/)
[![runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen.svg)](#runtime-requirements)
[![stability](https://img.shields.io/badge/stability-experimental-orange.svg)](#stability)

A zero-runtime-dependency structured JSON logger for Node.js. It emits one
newline-delimited JSON record per call to stdout, stderr, a file descriptor, a
writable destination, or lifecycle-aware transports.

## Features

- **Stable NDJSON envelope** - Numeric `level`, epoch-millisecond `time`,
  optional `msg`, bindings, and call fields.
- **Pino-compatible severities** - `trace=10` through `fatal=60`, plus explicit
  custom levels.
- **Cheap child loggers** - Bindings are serialized once during `child()`
  construction and output state is shared.
- **Safe serialization** - Circular references, `BigInt`, bounded object depth,
  bounded edge count, and recursive `Error.cause` handling.
- **Compiled redaction** - Exact, wildcard, dot, and bracket paths with censor
  and removal modes.
- **Fast default path** - Manual JSON encoding without a record object, callback
  arrays, or runtime dependencies.
- **Opt-in extensions** - Keyed serializers, structured hooks, formatters,
  transports, and a reversible `console.*` bridge.
- **Explicit delivery lifecycle** - Immediate output by default, bounded opt-in
  buffering, synchronous crash flushing, and asynchronous transport close.
- **Observable failures** - Contained destination errors, loss counters, and a
  synchronous failure observer.
- **Modern package surface** - Native ESM and TypeScript declarations for
  Node.js 22 and 24.

## Installation

```bash
pnpm add @swarmmachina/swm-logs
```

## Runtime requirements

- Node.js `22.x` or `24.x`; other majors are rejected by the package engine
  constraint.
- Native ESM. CommonJS `require()` is not a supported package surface.
- Zero runtime dependencies. Transports, workers, file rotation, network
  clients, and vendor exporters are intentionally not bundled.

## Quick Start

<!-- example:test quick-start -->

```js
import Logger from '@swarmmachina/swm-logs'

const logger = new Logger({ bindings: { service: 'gateway' } })

logger.info({ port: 3000 }, 'listening')
logger.error(new Error('request failed'))
```

The first call emits one line shaped like this:

```json
{ "level": 30, "time": 1710000000000, "msg": "listening", "service": "gateway", "port": 3000 }
```

`time` is Unix epoch milliseconds. Every record ends with exactly one newline.
The default field order is envelope, pre-serialized bindings, then call fields.
Application fields named `level` or `time` are ignored. A `msg` field is used as
the message only when no explicit message argument is present.

## API Documentation

### Exports

```ts
import Logger, { ConsoleBridge, LEVELS, Logger as NamedLogger } from '@swarmmachina/swm-logs'
import type { DeliveryStats, LoggerOptions, LogRecord, LogTransport, RedactOptions } from '@swarmmachina/swm-logs'
```

The default and named `Logger` exports refer to the same class. `LEVELS` is a
frozen map of the six built-in numeric severities.

### `new Logger(options?)`

Construction validates the complete configuration. Invalid levels, paths,
callbacks, destinations, or bounds throw a synchronous `TypeError` before the
logger becomes visible to the application.

| Option               | Default      | Purpose                                                            |
| -------------------- | ------------ | ------------------------------------------------------------------ |
| `level`              | `'info'`     | Minimum enabled severity; `'silent'` disables output.              |
| `customLevels`       | none         | Additional name-to-number severity map.                            |
| `bindings`           | `{}`         | Root fields serialized once during construction.                   |
| `redact`             | none         | Path list or rich censor/removal configuration.                    |
| `serializers`        | none         | Top-level field serializers keyed by field name.                   |
| `buffering`          | `false`      | `true` for defaults or a bounded console buffer configuration.     |
| `console`            | `true`       | Deliver to `destination` in addition to transports.                |
| `destination`        | `'stdout'`   | `'stdout'`, `'stderr'`, a numeric fd, or an object with `write()`. |
| `transports`         | `[]`         | Fire-and-forget delivery owners.                                   |
| `hooks`              | none         | Synchronous `beforeFormat` and `afterFormat` hooks.                |
| `formatter`          | JSON encoder | Custom record-to-string encoder.                                   |
| `onDestinationError` | none         | Synchronous observer for contained delivery failures.              |
| `time`               | `Date.now`   | Epoch-millisecond clock, useful for deterministic tests.           |
| `errorCauseDepth`    | `5`          | Maximum number of errors retained from a cause chain.              |
| `depthLimit`         | `5`          | Maximum retained nested object/array depth.                        |
| `edgeLimit`          | `100`        | Maximum retained properties/elements per container.                |

`console: false` requires at least one transport. A custom `destination` or
console `buffering` cannot be combined with `console: false`.

### Log methods

Every built-in or custom level accepts the same call shapes:

```ts
logger.info('message')
logger.info({ requestId: 'r1', ok: true }, 'message')
logger.error(error)
logger.error({ err: error, requestId: 'r1' }, 'message')
logger.info('user %s has %d jobs', 'Ada', 3)
logger.log('notice', { deploymentId: 'd1' }, 'deployed')
```

`trace()`, `debug()`, `info()`, `warn()`, `error()`, `fatal()`, and `log()`
return `void`. `fatal()` writes severity 60; it does not terminate the process.
Serialization, clock, hook, formatter, and destination failures do not escape a
log method. A processing failure becomes a valid `logger_error` record.

| Name    | Value |
| ------- | ----: |
| `trace` |    10 |
| `debug` |    20 |
| `info`  |    30 |
| `warn`  |    40 |
| `error` |    50 |
| `fatal` |    60 |

Read or change the threshold through `logger.level`. Use
`logger.isLevelEnabled(level)` before expensive field construction. An unknown
level returns `false`; an invalid dynamic `log()` level produces a contained
`logger_error` record.

Custom levels are called through `log()` rather than generated instance
methods:

```ts
const customLevels = { notice: 35 } as const
const logger = new Logger({ customLevels, level: 'trace' })

logger.log('notice', 'deployed')
```

### Child loggers

Create one child per request, job, connection, or other bounded lifecycle and
reuse it for all records in that scope:

<!-- example:test child-logger -->

```js
import Logger from '@swarmmachina/swm-logs'

const rootLogger = new Logger({ bindings: { service: 'realtime-api' } })

export function requestLogger({ requestId, remoteAddress }) {
  return rootLogger.child({ requestId, remoteAddress })
}

const logger = requestLogger({ requestId: 'r1', remoteAddress: '127.0.0.1' })
logger.info('accepted')
```

`child(bindings, { level? })` pre-serializes new bindings and shares levels,
serializers, extensions, destination, transports, buffer, and delivery counters
with the root. Later mutation of a nested binding does not change emitted
output. `bindings()` returns a shallow copy of effective binding values.

The output lifecycle is also shared. Call `close()` once from the component that
owns the root logger; closing through a child affects the same transports and
buffer.

### Lifecycle and diagnostics

- `flush()` sends buffered console output and awaits transport `flush()`
  methods when present.
- `flushSync()` uses synchronous capabilities only. Use it on fatal paths where
  asynchronous cleanup cannot be awaited.
- `close()` flushes/releases the shared console buffer and coordinates all
  transport `close()` methods concurrently.
- `deliveryStats()` returns a detached snapshot with `destinationErrors`,
  `droppedBytes`, `droppedChunks`, and `droppedRecords`.

`flush()` and `close()` return `void` when every output is synchronous and a
`Promise<void>` when asynchronous transports participate. `await` works for
both forms.

## Serialization and redaction

Primitive fields use a manual encoder. Nested values follow JSON semantics with
these finite-safety extensions:

- circular ancestor references become `"[Circular]"`;
- `BigInt` values become decimal strings;
- `undefined`, functions, symbols, and symbol keys are omitted;
- non-finite numbers become `null`;
- `err` values include `type`, `message`, `stack`, recursive `cause`, and
  enumerable custom properties;
- values beyond `depthLimit` or `edgeLimit` become finite markers.

Top-level serializers run only for matching keys. Binding serializers run once
when a root or child is constructed; call-field serializers run once for every
enabled call.

<!-- example:test serializers -->

```js
import Logger from '@swarmmachina/swm-logs'

const logger = new Logger({
  serializers: {
    account: (account) => ({ id: account.id })
  }
})

logger.info({ account: { id: 7, accessToken: 'secret' } }, 'signed in')
```

Redact paths support dot notation, quoted or numeric bracket notation, `*`, and
`[*]`. A path list replaces matches with `"[Redacted]"`. Rich configuration can
provide a static/function `censor` or set `remove: true`.

<!-- example:test redact -->

```js
import Logger from '@swarmmachina/swm-logs'

const logger = new Logger({
  redact: ['req.headers.authorization', 'users[*].password']
})

logger.info(
  {
    req: { headers: { authorization: 'Bearer secret' } },
    users: [{ id: 7, password: 'secret' }]
  },
  'request'
)
```

A single supported path is fused with bounded serialization. Multiple and
overlapping paths use a compiled branch trie and copy only matched containers;
caller-owned data is not mutated. Wildcard work grows with the number of
properties or elements at the matched level, so prefer exact paths for known
schemas.

## Hooks, formatters, and transports

The opt-in extension flow is:

```text
arguments → prepared record → beforeFormat → formatter → afterFormat → console + transports
```

With no hooks and no formatter, the logger does not allocate `LogRecord` objects
or callback arrays. Enabling either selects the structured path for that root
and its children.

- `beforeFormat` receives an owned record after serializers and redaction. It
  may mutate top-level state or return `false` to drop the record.
- `formatter` returns a string. A trailing newline is added when absent.
- `afterFormat` can observe or replace the line, or return `false` to drop it.
- Hook/formatter failures become `logger_error` records.

Transports are stateful delivery owners and should be classes when they own a
queue, socket, worker, file, or timer:

<!-- example:test extensions -->

```js
import Logger from '@swarmmachina/swm-logs'

class MemoryTransport {
  #lines = []

  write(line, level) {
    this.#lines.push({ level, line })
  }

  records() {
    return this.#lines.map(({ line }) => JSON.parse(line))
  }

  close() {
    this.#lines = []
  }
}

const transport = new MemoryTransport()
const logger = new Logger({
  console: false,
  hooks: {
    beforeFormat(record) {
      record.fields.service = 'gateway'
    }
  },
  transports: [transport]
})

logger.info('listening')
await logger.close()
```

`LogTransport.write(line, level)` is a fire-and-forget acceptance boundary. It
must enqueue or accept quickly; blocking I/O blocks the event loop. Each
transport owns queue bounds, batching, backpressure, retry limits,
idempotency/deduplication, timeouts, persistence, and asynchronous failure
metrics. A synchronous transport throw is contained and does not prevent later
outputs from receiving the record.

`console` defaults to `true`, so transports normally receive each record in
addition to stdout or the configured destination. Console `buffering` never
delays transport delivery.

For low-volume direct delivery, HTTP and PostgreSQL can be separate resource
owners. Keep each class in its own application module; they are shown together
here only to document the complete transport contract. The PostgreSQL example
uses the application-owned dependency `pg` (`pnpm add pg`), not a dependency of
this package.

```js
import { randomUUID } from 'node:crypto'

class HttpTransport {
  #closed = false
  #endpoint
  #failures = 0
  #onError
  #pending = new Set()
  #timeoutMs

  constructor({ endpoint, onError, timeoutMs = 2000 }) {
    if (typeof onError !== 'function') throw new TypeError('onError must be a function')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive safe integer')
    }

    this.#endpoint = new URL(endpoint).href
    this.#onError = onError
    this.#timeoutMs = timeoutMs
  }

  write(line, level) {
    if (this.#closed) throw new Error('HttpTransport is closed')

    this.#track(this.#send(randomUUID(), line, level))
  }

  flush() {
    return Promise.all([...this.#pending]).then(() => undefined)
  }

  close() {
    this.#closed = true
    return this.flush()
  }

  stats() {
    return { failures: this.#failures, pendingRequests: this.#pending.size }
  }

  async #send(eventId, line, level) {
    const response = await fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-ndjson',
        'idempotency-key': eventId,
        'x-log-level': String(level)
      },
      body: line,
      signal: AbortSignal.timeout(this.#timeoutMs)
    })

    try {
      if (!response.ok) throw new Error(`log endpoint returned HTTP ${response.status}`)
    } finally {
      await response.body?.cancel()
    }
  }

  #track(work) {
    let pending

    pending = work.catch((error) => this.#report(error)).finally(() => this.#pending.delete(pending))

    this.#pending.add(pending)
  }

  #report(error) {
    this.#failures += 1

    try {
      this.#onError(error)
    } catch {
      // Failure reporting must not create an unhandled rejection.
    }
  }
}
```

The PostgreSQL destination stores one complete JSON record per query. Values are
parameterized; application data is never interpolated into SQL:

```sql
CREATE TABLE app_logs (
  event_id uuid PRIMARY KEY,
  level integer NOT NULL,
  record jsonb NOT NULL
);
```

```js
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

class PostgresTransport {
  #closed = false
  #closePromise
  #failures = 0
  #onError
  #pending = new Set()
  #pool

  constructor({ connectionString, onError }) {
    if (typeof onError !== 'function') throw new TypeError('onError must be a function')

    this.#onError = onError
    this.#pool = new Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 2000,
      statement_timeout: 2000,
      query_timeout: 2500
    })
    this.#pool.on('error', (error) => this.#report(error))
  }

  write(line, level) {
    if (this.#closed) throw new Error('PostgresTransport is closed')

    this.#track(
      this.#pool.query(
        `INSERT INTO app_logs (event_id, level, record)
         VALUES ($1::uuid, $2::integer, $3::jsonb)`,
        [randomUUID(), level, line]
      )
    )
  }

  flush() {
    return Promise.all([...this.#pending]).then(() => undefined)
  }

  close() {
    if (this.#closePromise !== undefined) return this.#closePromise

    this.#closed = true
    this.#closePromise = this.flush().then(() => this.#pool.end())

    return this.#closePromise
  }

  stats() {
    return {
      failures: this.#failures,
      pendingQueries: this.#pending.size,
      poolWaitingCount: this.#pool.waitingCount
    }
  }

  #track(work) {
    let pending

    pending = work.catch((error) => this.#report(error)).finally(() => this.#pending.delete(pending))

    this.#pending.add(pending)
  }

  #report(error) {
    this.#failures += 1

    try {
      this.#onError(error)
    } catch {
      // Failure reporting must not create an unhandled rejection.
    }
  }
}
```

Either transport can be used alone, or both can receive independent copies:

```js
const onError = (error) => process.stderr.write(`[log-delivery] ${String(error)}\n`)
const httpTransport = new HttpTransport({ endpoint: process.env.LOG_ENDPOINT, onError })
const postgresTransport = new PostgresTransport({ connectionString: process.env.DATABASE_URL, onError })
const logger = new Logger({ console: false, transports: [httpTransport, postgresTransport] })

logger.info({ requestId: 'r1' }, 'accepted')
await logger.close()
```

These transports intentionally have no batching, retry queue, or backpressure
bound. `write()` starts one asynchronous operation per record, so the in-flight
sets and the PostgreSQL pool wait queue can grow without limit under sustained
load. Use them only for low-rate delivery; export `stats()`, alert on failures
and growing pending counts, and move high-volume or durable delivery to a
bounded queue, WAL, outbox, or external logging agent. A final HTTP/SQL failure
is counted and the record is dropped. Fan-out to both destinations is not
transactional: one can succeed while the other fails.

## Output, backpressure, and shutdown

Immediate mode calls `process.stdout.write(line)` by default and adds no logger
queue. If a Node.js stream returns `false`, the runtime/stream owns its pending
bytes and logging continues. That signal is backpressure, not a delivery error;
a persistently slow pipe may therefore grow stream-owned memory.

For a strict application-level memory bound, use a transport with a bounded
queue and an explicit overflow policy. Decide whether overflow blocks the
producer, drops newest/oldest records, or persists to a WAL, and export those
decisions as metrics.

stdout backed by a regular file is synchronous on supported Node.js platforms;
piped stdout may be asynchronous. When crash durability is mandatory, use a
regular file or a numeric descriptor and call `flushSync()` on the fatal path.

### Buffered console output

<!-- example:test buffered -->

```js
import Logger from '@swarmmachina/swm-logs'

const logger = new Logger({
  buffering: { maxBytes: 64 * 1024, flushInterval: 1000, flushLevel: 'warn' }
})

logger.info('batched')
logger.warn('flushes the whole console buffer')

process.once('beforeExit', () => logger.flushSync())
```

The buffer flushes at `maxBytes`, on an unref'ed interval, or at `flushLevel`
and above. Defaults are 64 KiB, 1000 ms, and `warn`. It is reset even when the
destination throws, preserving the configured bound; one oversized record can
temporarily exceed that bound.

`flushSync()` uses `fs.writeSync()` when a numeric descriptor is known. A
generic writer without `fd` can only receive its ordinary `write()` call, which
the logger cannot make durable on its behalf.

### Graceful shutdown

The application owns the root lifecycle. Stop accepting work first, wait for
in-flight operations, then close the logger:

```js
let shutdownPromise

function shutdown(signal) {
  if (shutdownPromise !== undefined) return shutdownPromise

  shutdownPromise = (async () => {
    rootLogger.info({ signal }, 'shutdown started')
    await server.stopAccepting()
    await server.drain(10_000)
    await rootLogger.close()
  })()

  return shutdownPromise
}

function handleSignal(signal) {
  void shutdown(signal).catch((error) => {
    rootLogger.fatal({ err: error }, 'shutdown failed')
    rootLogger.flushSync()
    process.exitCode = 1
  })
}

process.once('SIGTERM', () => handleSignal('SIGTERM'))
process.once('SIGINT', () => handleSignal('SIGINT'))
```

Put timeouts around external transport cleanup; the logger cannot impose a
deadline on user-owned `flush()` or `close()` implementations. For fatal
exceptions where asynchronous work is unsafe, call `flushSync()` and let the
supervisor restart the process.

### Delivery failures

Destination and synchronous transport failures are contained. Install
`onDestinationError` to export an alert and inspect `deliveryStats()` for loss:

```ts
const logger = new Logger({
  onDestinationError(event) {
    deliveryFailureCounter.add(1, {
      operation: event.operation,
      droppedRecords: event.droppedRecords
    })
  }
})
```

The observer is synchronous, reentrancy-guarded, and its own failures are
contained. Keep it non-blocking and do not use it as a second delivery path.

## Console bridge

`ConsoleBridge` patches only the supplied console instance and owns the exact
methods needed to restore it.

<!-- example:test console-bridge -->

```js
import Logger, { ConsoleBridge } from '@swarmmachina/swm-logs'

const logger = new Logger()
const bridge = new ConsoleBridge(logger).install()

console.log('structured now')
bridge.restore()
```

`trace`, `debug`, `log`, `info`, `warn`, and `error` map to the corresponding
logger methods; `console.log` maps to `info`. Repeated `install()` and
`restore()` calls are safe. Restoration does not overwrite another patch that
replaced a method after installation.

## Migrating from pino

The default output works with NDJSON pipelines and parsers that recognize pino
numeric levels.

| pino                               | `@swarmmachina/swm-logs`                    |
| ---------------------------------- | ------------------------------------------- |
| `pino({ level })`                  | `new Logger({ level })`                     |
| `base`                             | `bindings`                                  |
| `customLevels`                     | `customLevels` + `log(name, ...)`           |
| redact path list                   | `redact` path list                          |
| `timestamp` fragment function      | `time` returning epoch milliseconds         |
| synchronous destination            | immediate mode (default)                    |
| asynchronous destination           | `buffering` or an owned transport           |
| transports / worker pretty printer | `transports[]`; implementations not bundled |
| custom serializers                 | keyed `serializers` plus built-in `err`     |
| hooks / formatters                 | opt-in structured extension pipeline        |

Object-field ordering is intentionally envelope-first, with `msg` before
bindings and call fields. Compatibility tests compare complete output bytes;
do not rely on another logger's default key order during migration.

## Performance

Performance numbers are hardware, runtime, destination, and workload specific.
The repository therefore stores scenario baselines and CI artifacts instead of
publishing one machine's snapshot as a portable promise.

```bash
pnpm bench
pnpm bench:b1
pnpm bench:b7
pnpm profile:ci
pnpm profile:compare
pnpm profile:extensions
```

The harness covers message-only, flat fields, child bindings, `Error.cause`,
buffered output, cold ESM import, wildcard redaction, hooks, formatters, and
transport fan-out. Runs are isolated in child processes, alternate comparison
order, and report throughput, p95/p99, event-loop utilization, RSS, and sampled
allocations. Use `--destination file` when storage cost matters.

Committed baselines live in `benchmark/baselines/`. Recalibrate them from
several green runs whenever the Node version, operating system, CPU governor,
hardware, or benchmark destination changes.

## Testing

```bash
pnpm check
pnpm test
pnpm test:e2e
pnpm test:leak
pnpm test:types
pnpm test:package
pnpm release:gate
```

The release gate builds the package, checks formatting/lint/source and test
types, runs unit/e2e/leak tests, installs the packed tarball into a consumer
fixture, and verifies package metadata and contents. Marked README examples are
extracted and executed by the e2e suite.

Tests cover output byte compatibility, circular and bounded serialization,
`Error.cause`, redaction, serializers, extension failures, transport fan-out,
delivery counters, timer/size/severity flushing, console restoration, packed
TypeScript resolution, and immediate-exit output.

## Release

CI runs for `v*` tags and manual dispatches. A release tag must equal the
`package.json` version (`vX.Y.Z`), its commit must belong to `master`, the pnpm
version must be pinned, and `pnpm-lock.yaml` must match the manifest.

After all correctness and benchmark gates pass, the package job:

1. builds `dist/` from the checked-out commit;
2. packs exactly once and validates package identity and a strict file allowlist;
3. writes `release-manifest.json` with size, git SHA, SHA-256, SHA-512, and npm
   integrity;
4. uploads the tarball, manifest, checksum, and publish script as one artifact.

The publish job downloads that exact artifact, verifies `SHA256SUMS`, recomputes
tarball integrity, and queries npm before publishing. Retrying an already
published identical version succeeds; the same version with different content
fails closed. Manual dispatch runs every gate and creates the artifact without
publishing.

The publish job runs on a GitHub-hosted runner, requests an OIDC identity token,
and makes npm provenance mandatory. `publishConfig.provenance` and the explicit
`--provenance` argument also prevent an accidental non-attested publication.

npm requires the source repository to be public before it will issue a
provenance attestation. A release tag therefore fails during `source-policy`
while this GitHub repository is private. Make the repository public before
creating the first release tag; do not bypass the check or publish the version
manually without provenance.

For a local release rehearsal, first ensure `release-artifact/` is empty:

```bash
pnpm release
```

This runs every correctness gate and creates the same immutable artifact, but it
does not publish: provenance publication is CI-only. The output directory is
intentionally fail-closed so stale tarballs cannot be mixed with a new manifest.
Never reuse a published version or release tag.

Rollback moves `latest` to a known-good version and deprecates the bad version:

```bash
npm dist-tag add @swarmmachina/swm-logs@<GOOD_VERSION> latest
npm deprecate @swarmmachina/swm-logs@<BAD_VERSION> "Use <GOOD_VERSION>"
```

### Self-hosted runner

`regression-gate` targets the organization runner group `swm-ci` with the
`bench` label. The workflow has no pull-request trigger: untrusted PR code must
not run on a shared self-hosted runner.

Keep the benchmark runner isolated and disposable, run it as an unprivileged
user, allow only required outbound traffic, and expose no production secrets.
Prefer ephemeral registration so every release starts from a clean machine:

```bash
./config.sh --url https://github.com/<owner>/<repo> --token <RUNNER_TOKEN> --labels bench --ephemeral
sudo ./svc.sh install <user>
sudo ./svc.sh start
```

Keep the host idle during profiles and use a stable performance governor where
the platform supports it.

## Runtime design

- `Logger` owns per-instance bindings and level state.
- `LevelRegistry` owns validated immutable level lookup tables.
- `FieldSerializer` owns serializers/redaction configuration and is shared by
  children.
- `Redactor` owns the compiled single-path or branch-trie strategy without
  mutating caller data.
- `OutputDestination` owns one stdout/stderr/fd/writer target.
- `ExtensionPipeline` exists only when hooks or a formatter are configured.
- `OutputPipeline` owns destination/transport fan-out, lifecycle, and shared
  delivery counters.
- `BufferedWriter` owns the opt-in bounded console queue and timer.
- `ConsoleBridge` owns installation and restoration of global console methods.
- Argument parsing and JSON transformations remain pure functions.

There is no hidden worker, retry loop, global singleton, or asynchronous queue
in the default path. External resource owners stay explicit at the transport
boundary.

## Stability

The package is experimental at `0.x`. Public APIs and runtime behavior may
change before a stable release. The NDJSON envelope and numeric levels are
intended to stabilize first; benchmark baselines remain runner-specific.

## Contributing

Contributions should include tests for behavior changes and benchmark evidence
for hot-path changes.

1. Fork the repository.
2. Create a feature branch.
3. Run `pnpm release:gate` and the relevant performance profile.
4. Commit and push the branch.
5. Open a pull request.

## License

Licensed under the MPL-2.0 License.

Copyright Contributors to SwarmMachina.

See [LICENSE](LICENSE) for details.
