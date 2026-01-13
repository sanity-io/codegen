import {setup as cliSetup} from '@sanity/cli-test/vitest'
import {type TestProject} from 'vitest/node'

export function setup(project: TestProject) {
  return cliSetup(project, {
    additionalExamples: ['dev'],
  })
}

export {teardown} from '@sanity/cli-test/vitest'
