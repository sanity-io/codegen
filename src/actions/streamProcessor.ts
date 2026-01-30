import {writeFile} from 'node:fs/promises'

import {subdebug} from '@sanity/cli-core'
import {spinner} from '@sanity/cli-core/ux'
import {WorkerChannelReceiver} from '@sanity/worker-channels'
import {format, resolveConfig as resolvePrettierConfig} from 'prettier'

import {TypeGenConfig} from '../readConfig.js'
import {count} from '../utils/count.js'
import {formatPath} from '../utils/formatPath.js'
import {getMessage} from '../utils/getMessage.js'
import {percent} from '../utils/percent.js'
import {generatedFileWarning} from './generatedFileWarning.js'
import {TypegenWorkerChannel} from './types.js'

const debug = subdebug('typegen:generate')

/**
 * Processes the event stream from a typegen worker thread.
 *
 * Listens to worker channel events, displays progress via CLI spinners,
 * writes the generated types to disk, and optionally formats with prettier.
 *
 * @param receiver - Worker channel receiver for typegen events
 * @param options - Typegen configuration options
 * @returns Generation result containing the generated code and statistics
 */
export async function processTypegenWorkerStream(
  receiver: WorkerChannelReceiver<TypegenWorkerChannel>,
  options: TypeGenConfig,
) {
  const start = Date.now()
  const {formatGeneratedCode, generates, schema} = options
  let code = ''

  const spin = spinner().start(`Loading schema…`)

  try {
    await receiver.event.loadedSchema()
    spin.succeed(`Schema loaded from ${formatPath(schema ?? '')}`)

    spin.start('Generating schema types…')
    const {expectedFileCount} = await receiver.event.typegenStarted()
    const {schemaTypeDeclarations} = await receiver.event.generatedSchemaTypes()
    const schemaTypesCount = schemaTypeDeclarations.length

    spin.text = 'Generating query types…'

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

      for (const error of errors) {
        spin.fail(getMessage(error))
      }

      if (!spin.isSpinning) {
        spin.start()
      }

      spin.text =
        `Generating query types… (${percent(evaluatedFiles / expectedFileCount)})\n` +
        `  └─ Processed ${count(evaluatedFiles)} of ${count(expectedFileCount, 'files')}. ` +
        `Found ${count(queriesCount, 'queries', 'query')} from ${count(queryFilesCount, 'files')}.`
    }

    const result = await receiver.event.typegenComplete()
    code = `${generatedFileWarning}${result.code}`
    await writeFile(generates, code)

    let formattingError = false
    if (formatGeneratedCode) {
      spin.text = `Formatting generated types with prettier…`

      try {
        const prettierConfig = await resolvePrettierConfig(generates)
        const formattedCode = await format(code, {
          ...prettierConfig,
          parser: 'typescript' as const,
        })
        await writeFile(generates, formattedCode)
      } catch (err) {
        formattingError = true
        spin.warn(`Failed to format generated types with prettier: ${getMessage(err)}`)
      }
    }

    if (filesWithErrors > 0) {
      spin.warn(`Encountered errors in ${count(filesWithErrors, 'files')} while generating types`)
    }

    const stats = {
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

    let successText =
      `Successfully generated types to ${formatPath(generates)} in ${Number(stats.duration).toFixed(0)}ms` +
      `\n  └─ ${count(queriesCount, 'queries', 'query')} and ${count(schemaTypesCount, 'schema types', 'schema type')}` +
      `\n  └─ found queries in ${count(queryFilesCount, 'files', 'file')} after evaluating ${count(evaluatedFiles, 'files', 'file')}`

    if (formatGeneratedCode) {
      successText += `\n  └─ ${formattingError ? 'an error occured during formatting' : 'formatted the generated code with prettier'}`
    }

    spin.succeed(successText)

    return {
      ...stats,
      code,
    }
  } catch (err) {
    spin.fail()
    debug('error generating types', err)
    throw err
  } finally {
    receiver.unsubscribe()
  }
}
