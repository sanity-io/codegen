import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {processTypegenWorkerStream} from '../streamProcessor.js'
import {type TypegenProgressEvent} from '../types.js'

// Minimal fake matching the members processTypegenWorkerStream uses.
function createFakeReceiver() {
  return {
    event: {
      generatedSchemaTypes: async () => ({schemaTypeDeclarations: ['type A = 1']}),
      loadedSchema: async () => undefined,
      typegenComplete: async () => ({code: 'export type Query = number\n'}),
      typegenStarted: async () => ({expectedFileCount: 1}),
    },
    stream: {
      evaluatedModules: async function* () {
        yield {
          errors: [],
          queries: [
            {stats: {allTypes: 2, emptyUnions: 0, unknownTypes: 0}},
          ],
        }
      },
    },
    unsubscribe: () => {},
  }
}

describe('processTypegenWorkerStream', () => {
  let dir: string
  let generates: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'codegen-stream-'))
    generates = join(dir, 'sanity.types.ts')
  })
  afterEach(async () => {
    await rm(dir, {force: true, recursive: true})
  })

  test('emits progress events and writes the file', async () => {
    const events: TypegenProgressEvent[] = []
    const receiver = createFakeReceiver()

    const result = await processTypegenWorkerStream(
      receiver,
      {formatGeneratedCode: false, generates, overloadClientMethods: false, path: ['x'], schema: 's.json'},
      (event) => events.push(event),
    )

    const types = events.map((event) => event.type)
    expect(types).toContain('schemaLoaded')
    expect(types).toContain('typegenStarted')
    expect(types).toContain('schemaTypesGenerated')
    expect(types).toContain('moduleEvaluated')
    expect(types).toContain('complete')

    expect(result.queriesCount).toBe(1)
    expect(result.schemaTypesCount).toBe(1)
    expect(result.typeNodesGenerated).toBe(2)

    const written = await readFile(generates, 'utf8')
    expect(written).toContain('export type Query = number')
  })
})
