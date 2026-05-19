import {stat} from 'node:fs/promises'
import {isAbsolute, join} from 'node:path'
import {isMainThread, parentPort, workerData} from 'node:worker_threads'

import {WorkerChannelReporter} from '@sanity/worker-channels'

import {findQueriesInPath} from '../polyglot/typescript/findQueriesInPath.js'
import {getResolver} from '../polyglot/typescript/moduleResolver.js'
import {registerBabel} from '../polyglot/typescript/registerBabel.js'
import {TypeGenerator} from '../polyglot/typescript/typeGenerator.js'
import {readSchema} from '../readSchema.js'
import {TypegenGenerateTypesWorkerData, TypegenWorkerChannel} from './types.js'

if (isMainThread || !parentPort) {
  throw new Error('This module must be run as a worker thread')
}

registerBabel()

async function main({
  overloadClientMethods,
  schemaPath,
  searchPath,
  workDir,
}: TypegenGenerateTypesWorkerData) {
  const report = WorkerChannelReporter.from<TypegenWorkerChannel>(parentPort)

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
