import Logger from '../../../dist/index.js'

const logger = new Logger({ buffering: { flushInterval: 0, maxBytes: 1024 * 1024 } })

for (let index = 0; index < 10_000; index += 1) {
  logger.info({ index }, 'before-flush-sync')
}

logger.flushSync()
process.exit(0)
