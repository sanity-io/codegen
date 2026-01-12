import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    typecheck: {
      exclude: ['.tmp/**', './lib/**'],
    },
    exclude: ['.tmp/**', './lib/**', './node_modules/**'],
    includeSource: ['./src/**/*.ts'],
  },
})
