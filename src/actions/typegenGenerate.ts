import {debug} from 'node:console'
import {mkdir} from 'node:fs/promises'
import {dirname, isAbsolute, join} from 'node:path'
import {env} from 'node:process'
import {Worker} from 'node:worker_threads'

import {WorkerChannelReceiver} from '@sanity/worker-channels'

import {processTypegenWorkerStream} from './streamProcessor.js'
import {
  type GenerationResult,
  type RunTypegenOptions,
  TypegenGenerateTypesWorkerData,
  TypegenWorkerChannel,
} from './types.js'

/**
 * Runs a single typegen generation.
 *
 * This is the programmatic API for generating TypeScript types from GROQ queries.
 * It spawns a worker thread to perform the generation and displays progress via CLI spinners.
 *
 * @param options - Configuration options including typegen config and working directory
 * @returns Generation result containing the generated code and statistics
 */
export async function runTypegenGenerate(options: RunTypegenOptions): Promise<GenerationResult> {
  const {config, workDir} = options

  const {formatGeneratedCode, generates, overloadClientMethods, path, schema} = config

  const outputPath = isAbsolute(generates) ? generates : join(workDir, generates)

  // create output dir if it isn't there
  const outputDir = dirname(outputPath)
  await mkdir(outputDir, {recursive: true})

  // set up worker
  const workerPath = new URL('../actions/typegenGenerate.worker.js', import.meta.url)
  const workerData: TypegenGenerateTypesWorkerData = {
    overloadClientMethods,
    schemaPath: schema,
    searchPath: path,
    workDir,
  }
  const worker = new Worker(workerPath, {env, workerData})

  try {
    const result = await processTypegenWorkerStream(
      WorkerChannelReceiver.from<TypegenWorkerChannel>(worker),
      {
        formatGeneratedCode,
        generates: outputPath,
        overloadClientMethods,
        path,
        schema,
      },
    )

    return result
  } catch (err) {
    debug('error generating types', err)
    throw err
  } finally {
    worker.terminate()
  }
}
