import {defineConfig} from 'vitest/config'

export default defineConfig({
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
