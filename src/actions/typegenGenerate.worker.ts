import {stat} from 'node:fs/promises'
import path from 'node:path'
import {isMainThread, parentPort, workerData} from 'node:worker_threads'

import {type WorkerChannel, WorkerChannelReporter} from '@sanity/worker-channels'

import {readSchema} from '../readSchema.js'
import {findQueriesInPath} from '../typescript/findQueriesInPath.js'
import {getResolver} from '../typescript/moduleResolver.js'
import {registerBabel} from '../typescript/registerBabel.js'
import {
  type TypegenWorkerChannel as CodegenTypegenWorkerChannel,
  TypeGenerator,
} from '../typescript/typeGenerator.js'

export interface TypegenGenerateTypesWorkerData {
  schemaPath: string
  searchPath: string | string[]
  workDir: string

  overloadClientMethods?: boolean
}

if (isMainThread || !parentPort) {
  throw new Error('This module must be run as a worker thread')
}

registerBabel()

export type TypegenWorkerChannel = WorkerChannel.Definition<
  CodegenTypegenWorkerChannel['__definition'] & {
    loadedSchema: WorkerChannel.Event
    typegenComplete: WorkerChannel.Event<{code: string}>
    typegenStarted: WorkerChannel.Event<{expectedFileCount: number}>
  }
>

async function main({
  overloadClientMethods,
  schemaPath,
  searchPath,
  workDir,
}: TypegenGenerateTypesWorkerData) {
  const report = WorkerChannelReporter.from<TypegenWorkerChannel>(parentPort)

  const fullPath = path.join(workDir, schemaPath)

  try {
    const schemaStats = await stat(fullPath)
    if (!schemaStats.isFile()) {
      throw new Error(`Schema path is not a file: ${schemaPath}`)
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      // If the user has not provided a specific schema path (eg we're using the default), give some help
      const hint = schemaPath === './schema.json' ? ` - did you run "sanity schema extract"?` : ''
      throw new Error(`Schema file not found: ${fullPath}${hint}`, {cause: err})
    }
    throw err
  }

  const schema = await readSchema(fullPath)

  report.event.loadedSchema()

  const typeGenerator = new TypeGenerator()

  const {files, queries} = findQueriesInPath({
    path: searchPath,
    resolver: getResolver(workDir),
  })
  report.event.typegenStarted({expectedFileCount: files.length})

  const result = await typeGenerator.generateTypes({
    overloadClientMethods,
    queries,
    reporter: report,
    root: workDir,
    schema,
    schemaPath,
  })
  report.event.typegenComplete(result)
}

await main(workerData)
