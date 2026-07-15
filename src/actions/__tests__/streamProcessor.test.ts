import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import * as t from '@babel/types'
import {WorkerChannelReceiver, WorkerChannelReporter} from '@sanity/worker-channels'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {processTypegenWorkerStream} from '../streamProcessor.js'
import {type TypegenProgressEvent, type TypegenWorkerChannel} from '../types.js'

/**
 * Builds a minimal, but fully and correctly typed, `{ast, code, id}` triple
 * as required by the `generatedSchemaTypes` event payload.
 */
function fakeDeclaration(name: string) {
  const id = t.identifier(name)
  const ast = t.exportNamedDeclaration(t.tsTypeAliasDeclaration(id, null, t.tsStringKeyword()))
  return {ast, code: `export type ${name} = string;\n`, id}
}

/** Builds a minimal, fully typed schema type declaration entry. */
function fakeSchemaTypeDeclaration(name: string) {
  return {...fakeDeclaration(name), name, tsType: t.tsStringKeyword()}
}

/** Builds a minimal, fully typed evaluated query entry. */
function fakeEvaluatedQuery(filename: string, queryName: string) {
  const id = t.identifier(queryName)
  const ast = t.exportNamedDeclaration(t.tsTypeAliasDeclaration(id, null, t.tsNumberKeyword()))
  return {
    ast,
    code: `export type ${queryName} = number;\n`,
    filename,
    id,
    query: '*[_type == "foo"]',
    stats: {allTypes: 2, emptyUnions: 0, unknownTypes: 0},
    tsType: t.tsNumberKeyword(),
    variable: {id: t.identifier('query')},
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
    const emitter = new EventTarget()
    const receiver = WorkerChannelReceiver.from<TypegenWorkerChannel>(emitter)
    const reporter = WorkerChannelReporter.from<TypegenWorkerChannel>(emitter)

    // Start the processor without awaiting, then drive the real receiver via
    // a real reporter, mirroring the events a typegen worker would emit.
    const resultPromise = processTypegenWorkerStream(
      receiver,
      {
        formatGeneratedCode: false,
        generates,
        overloadClientMethods: false,
        path: ['x'],
        schema: 's.json',
      },
      (event) => events.push(event),
    )

    reporter.event.loadedSchema()
    reporter.event.typegenStarted({expectedFileCount: 1})
    reporter.event.generatedSchemaTypes({
      allSanitySchemaTypesDeclaration: fakeDeclaration('AllSanitySchemaTypes'),
      internalReferenceSymbol: fakeDeclaration('InternalReferenceSymbol'),
      schemaTypeDeclarations: [fakeSchemaTypeDeclaration('A')],
    })
    reporter.stream.evaluatedModules.emit({
      errors: [],
      filename: '/src/query.ts',
      queries: [fakeEvaluatedQuery('/src/query.ts', 'QueryResult')],
    })
    reporter.stream.evaluatedModules.end()
    reporter.event.typegenComplete({code: 'export type Query = number\n'})

    const result = await resultPromise

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
