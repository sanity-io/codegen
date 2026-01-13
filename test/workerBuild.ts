import {setupWorkerBuild, teardownWorkerBuild} from '@sanity/cli-test/vitest'
import {glob} from 'tinyglobby'

export async function setup() {
  const files = await glob('**/*.worker.ts', {
    ignore: ['**/node_modules/**', '**/dist/**'],
  })
  return setupWorkerBuild(files)
}

export function teardown() {
  return teardownWorkerBuild()
}
