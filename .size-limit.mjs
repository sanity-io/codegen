const bundle = {
  modifyEsbuildConfig(config) {
    config.external.push('fsevents')
    config.format = 'esm'
    config.platform = 'node'
    config.target = 'node22'
    return config
  },
  path: '.size-limit-entry.mjs',
}

export default [
  {
    ...bundle,
    brotli: false,
    name: '@sanity/codegen bundle (raw)',
  },
  {
    ...bundle,
    name: '@sanity/codegen bundle (Brotli)',
  },
]
