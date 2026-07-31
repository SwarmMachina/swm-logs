import config from '@swarmmachina/standards/eslint-typescript'

config.push({
  ignores: ['dist/', 'benchmark/**/*.js', 'benchmark/**/*.d.ts', 'benchmark/**/*.map']
})

config.push({
  rules: {
    'n/no-process-exit': 'off',
    'n/no-unsupported-features/es-syntax': 'off'
  }
})

export default config
