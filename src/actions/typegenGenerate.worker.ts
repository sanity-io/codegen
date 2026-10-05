import {stat} from 'node:fs/promises'
import {isAbsolute, join} from 'node:path'
import {isMainThread, parentPort, workerData} from 'node:worker_threads'

import {WorkerChannelReporter} from '@sanity/worker-channels'

import {readSchema} from '../readSchema.js'
import {findQueriesInPath} from '../typescript/findQueriesInPath.js'
import {getResolver} from '../typescript/moduleResolver.js'
import {registerBabel} from '../typescript/registerBabel.js'
import {TypeGenerator} from '../typescript/typeGenerator.js'
import {TypegenGenerateTypesWorkerData, TypegenWorkerChannel} from './types.js'

if (isMainThread || !parentPort) {
  throw new Error('This module must be run as a worker thread')
}

registerBabel()

async function loadSchema(schemaPath: string, workDir: string) {
  const fullPath = isAbsolute(schemaPath) ? schemaPath : join(workDir, schemaPath)

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

  return readSchema(fullPath)
}

async function main({
  extractedSchema,
  overloadClientMethods,
  resource,
  schemaPath,
  searchPath,
  workDir,
}: TypegenGenerateTypesWorkerData) {
  const report = WorkerChannelReporter.from<TypegenWorkerChannel>(parentPort)

  const schema = extractedSchema ?? (await loadSchema(schemaPath, workDir))

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
    resource,
    root: workDir,
    schema,
    // Only a schema read from disk has a path worth naming in the output.
    schemaPath: extractedSchema ? undefined : schemaPath,
  })
  report.event.typegenComplete(result)
}

await main(workerData)
