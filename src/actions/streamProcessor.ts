import {writeFile} from 'node:fs/promises'

import {WorkerChannelReceiver} from '@sanity/worker-channels'

import {TypeGenConfig} from '../readConfig.js'
import {debug} from '../utils/debug.js'
import {getMessage} from '../utils/getMessage.js'
import {defineFormatter} from '../utils/resolveFormatter.js'
import {generatedFileWarning} from './generatedFileWarning.js'
import {type TypegenProgressEvent, TypegenWorkerChannel} from './types.js'

const noopProgress = (_event: TypegenProgressEvent): void => {}

/**
 * Processes the event stream from a typegen worker thread.
 *
 * Consumes worker channel events, reports progress via `onProgress`,
 * writes generated types to disk, and optionally formats them.
 */
export async function processTypegenWorkerStream(
  receiver: WorkerChannelReceiver<TypegenWorkerChannel>,
  options: TypeGenConfig,
  onProgress: (event: TypegenProgressEvent) => void = noopProgress,
) {
  const start = Date.now()
  const {formatGeneratedCode, generates} = options

  try {
    await receiver.event.loadedSchema()
    onProgress({type: 'schemaLoaded'})

    const {expectedFileCount} = await receiver.event.typegenStarted()
    onProgress({expectedFileCount, type: 'typegenStarted'})

    const {schemaTypeDeclarations} = await receiver.event.generatedSchemaTypes()
    const schemaTypesCount = schemaTypeDeclarations.length
    onProgress({schemaTypesCount, type: 'schemaTypesGenerated'})

    let queriesCount = 0
    let evaluatedFiles = 0
    let filesWithErrors = 0
    let queryFilesCount = 0
    let typeNodesGenerated = 0
    let unknownTypeNodesGenerated = 0
    let emptyUnionTypeNodesGenerated = 0

    for await (const {errors, queries} of receiver.stream.evaluatedModules()) {
      evaluatedFiles++
      queriesCount += queries.length
      queryFilesCount += queries.length > 0 ? 1 : 0
      filesWithErrors += errors.length > 0 ? 1 : 0

      for (const {stats} of queries) {
        typeNodesGenerated += stats.allTypes
        unknownTypeNodesGenerated += stats.unknownTypes
        emptyUnionTypeNodesGenerated += stats.emptyUnions
      }

      onProgress({
        errors: errors.map((error) => getMessage(error)),
        evaluatedFiles,
        expectedFileCount,
        queriesCount,
        queryFilesCount,
        type: 'moduleEvaluated',
      })
    }

    const result = await receiver.event.typegenComplete()
    const code = `${generatedFileWarning}${result.code}`
    await writeFile(generates, code)

    if (formatGeneratedCode !== false) {
      const formatter = defineFormatter(formatGeneratedCode)
      if (formatter) {
        try {
          const {format} = await formatter.resolve()
          if (format) {
            onProgress({formatterName: formatter.name, type: 'formatting'})
            const formattedCode = await format(generates, code)
            await writeFile(generates, formattedCode)
          }
        } catch (err) {
          onProgress({
            formatterName: formatter.name,
            message: getMessage(err),
            type: 'formatFailed',
          })
        }
      }
    }

    const generationResult = {
      code,
      duration: Date.now() - start,
      emptyUnionTypeNodesGenerated,
      filesWithErrors,
      outputSize: Buffer.byteLength(code),
      queriesCount,
      queryFilesCount,
      schemaTypesCount,
      typeNodesGenerated,
      unknownTypeNodesGenerated,
      unknownTypeNodesRatio:
        typeNodesGenerated > 0 ? unknownTypeNodesGenerated / typeNodesGenerated : 0,
    }

    onProgress({result: generationResult, type: 'complete'})

    return generationResult
  } catch (err) {
    debug('error generating types', err)
    throw err
  } finally {
    receiver.unsubscribe()
  }
}
