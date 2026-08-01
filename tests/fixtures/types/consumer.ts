import Logger, {
  ConsoleBridge,
  LEVELS,
  type DeliveryStats,
  type DestinationErrorEvent,
  type BufferingOptions,
  type LoggerOptions,
  type LogDestination,
  type LogRecord,
  type LogTransport
} from '@swarmmachina/swm-logs'

const chunks: string[] = []
const destination: LogDestination = {
  write(chunk) {
    chunks.push(chunk)
  }
}
const buffering: BufferingOptions = { flushInterval: 0, flushLevel: 'warn', maxBytes: 64 * 1024 }
const options: LoggerOptions = { buffering, destination, level: 'trace', redact: ['token'] }
const logger = new Logger(options)
const customLevels = { notice: 35 } as const
const custom = new Logger({ customLevels, destination })

class MemoryTransport implements LogTransport {
  write(_line: string, _level: number): void {}

  flushSync(): void {}
}
const transport = new MemoryTransport()
const extended = new Logger({
  formatter(record: Readonly<LogRecord>) {
    return `${record.levelLabel} ${record.message ?? ''}`
  },
  hooks: {
    beforeFormat(record) {
      record.fields.release = 'test'
    }
  },
  onDestinationError(event: DestinationErrorEvent) {
    void event.operation
  },
  redact: { censor: '***', paths: ['users[*].password'] },
  serializers: { user: (value) => value },
  console: false,
  transports: [transport]
})

logger.info({ ready: true }, 'started')
custom.log('notice', 'dynamic')
extended.info('formatted')

const stats: DeliveryStats = extended.deliveryStats()
const target = console
const bridge: ConsoleBridge = new ConsoleBridge(logger, target).install()

bridge.restore()

// @ts-expect-error buffering maxBytes must be numeric
new Logger({ buffering: { maxBytes: '64k' } })
// @ts-expect-error destination must expose write()
new Logger({ destination: {} })
// @ts-expect-error singular transport API was intentionally removed
new Logger({ transport })

void chunks
void LEVELS
void stats
