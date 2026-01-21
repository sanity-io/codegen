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
    disableConsoleIntercept: true, // helps @oclif/test helpers
    exclude: ['**/.tmp/**', 'dev/**', '**/lib/**', '**/node_modules/**'],
    globalSetup: ['test/workerBuild.ts', 'test/cliTestSetup.ts'],
    includeSource: ['./src/**/*.ts'],
  },
})
