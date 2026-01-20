import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/*.tmp/**', '**/dist/**', '**/lib/**', 'dev/**', '**/node_modules/**'],
    includeSource: ['./src/**/*.ts'],
    typecheck: {
      exclude: ['.tmp/**', './lib/**'],
    },
  },
})
