import {env} from 'node:process'
import {Worker} from 'node:worker_threads'

import {WorkerChannelReceiver} from '@sanity/worker-channels'

import {generatedFileWarning} from '../../actions/generatedFileWarning.js'
import {
  type TypegenGenerateTypesWorkerData,
  type TypegenWorkerChannel,
} from '../../actions/types.js'
import {type BaseLanguageConfig, type GenerationOutput, type LanguageGenerator} from '../index.js'

/** @public */
export interface TypeScriptLanguageConfig extends BaseLanguageConfig {
  overloadClientMethods?: boolean
  path?: string | string[]
}

const DEFAULT_TS_PATHS = [
  './src/**/*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte}',
  './app/**/*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte}',
  './sanity/**/*.{ts,tsx,js,jsx,mjs,cjs}',
]

function parseTypeScriptConfig(raw: unknown): TypeScriptLanguageConfig {
  if (raw === null || raw === undefined) raw = {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('typescript config: must be an object')
  }
  const block = raw as Record<string, unknown>
  const schema = typeof block.schema === 'string' ? block.schema : './schema.json'
  const generates = typeof block.generates === 'string' ? block.generates : './sanity.types.ts'
  const path = block.path === undefined ? DEFAULT_TS_PATHS : (block.path as string | string[])
  const overloadClientMethods =
    block.overloadClientMethods === undefined ? true : Boolean(block.overloadClientMethods)
  const formatGeneratedCode =
    block.formatGeneratedCode === undefined
      ? true
      : (block.formatGeneratedCode as 'oxfmt' | 'prettier' | boolean)
  return {formatGeneratedCode, generates, overloadClientMethods, path, schema}
}

/** @public */
export const typescriptGenerator: LanguageGenerator<TypeScriptLanguageConfig> = {
  fileExtension: '.ts',
  async generate({config, workDir}): Promise<GenerationOutput> {
    const workerPath = new URL('../../actions/typegenGenerate.worker.js', import.meta.url)
    const workerData: TypegenGenerateTypesWorkerData = {
      overloadClientMethods: config.overloadClientMethods ?? true,
      schemaPath: config.schema,
      searchPath: config.path ?? DEFAULT_TS_PATHS,
      workDir,
    }
    const worker = new Worker(workerPath, {env, workerData})
    const receiver = WorkerChannelReceiver.from<TypegenWorkerChannel>(worker)

    try {
      await receiver.event.loadedSchema()
      const {expectedFileCount} = await receiver.event.typegenStarted()
      const {schemaTypeDeclarations} = await receiver.event.generatedSchemaTypes()
      const schemaTypesCount = schemaTypeDeclarations.length

      let queriesCount = 0
      let queryFilesCount = 0
      let evaluatedFiles = 0
      let filesWithErrors = 0
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
      }

      const result = await receiver.event.typegenComplete()
      const code = `${generatedFileWarning}${result.code}`

      return {
        code,
        stats: {
          documents: schemaTypesCount,
          emptyUnionTypeNodesGenerated,
          evaluatedFiles,
          expectedFileCount,
          filesWithErrors,
          objects: 0,
          queriesCount,
          queryFilesCount,
          schemaTypesCount,
          skipped: [],
          typeNodesGenerated,
          unknownTypeNodesGenerated,
        },
      }
    } finally {
      receiver.unsubscribe()
      await worker.terminate()
    }
  },
  id: 'typescript',
  parseConfig: parseTypeScriptConfig,
}
