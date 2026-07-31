import Logger from '../../../dist/index.js'

const logger = new Logger()

for (let index = 0; index < 10_000; index += 1) {
  logger.info({ index }, 'before-exit')
}

process.exit(0)
