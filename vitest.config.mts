import {defineConfig} from 'vitest/config'

export default defineConfig({
  // This is needed to avoid listening to changes in the tmp directory
  // Without this, watch will go in an infinite loop
  server: {
    watch: {
      ignored: ['**/tmp/**/*'],
    },
  },
  test: {
    coverage: {
      provider: 'istanbul',
    },
    exclude: ['**/.tmp/**', 'dev/**', '**/lib/**', '**/dist/**', '**/node_modules/**'],
    includeSource: ['./src/**/*.ts'],
  },
})
