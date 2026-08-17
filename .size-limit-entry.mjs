export * from './dist/_exports/index.js'

// The production import is opaque to bundlers, so include Prettier explicitly in this measurement.
export * as prettier from 'prettier'
