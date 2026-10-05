import {WorkerChannel} from '@sanity/worker-channels'
import {type SchemaType} from 'groq-js'

import {TypeGenConfig} from '../readConfig.js'
import {
  type TypegenWorkerChannel as CodegenTypegenWorkerChannel,
  type TypegenResource,
} from '../typescript/typeGenerator.js'

/**
 * Data passed to the typegen worker thread.
 * @internal
 */
export interface TypegenGenerateTypesWorkerData {
  /** Path to the schema JSON file */
  schemaPath: string
  /** Glob pattern(s) for finding query files */
  searchPath: string | string[]
  /** Working directory (project root) */
  workDir: string

  /** An extracted schema to use instead of reading `schemaPath`. */
  extractedSchema?: SchemaType
  /** Whether to generate client method overloads */
  overloadClientMethods?: boolean
  /** Register output under this resource. See `GenerateTypesOptions.resource`. */
  resource?: TypegenResource
}

/**
 * Worker channel definition for typegen worker communication.
 * Extends the base TypegenWorkerChannel with additional events for progress tracking.
 * @internal
 */
export type TypegenWorkerChannel = WorkerChannel.Definition<
  CodegenTypegenWorkerChannel['__definition'] & {
    loadedSchema: WorkerChannel.Event
    typegenComplete: WorkerChannel.Event<{code: string}>
    typegenStarted: WorkerChannel.Event<{expectedFileCount: number}>
  }
>

/**
 * Result from a single generation run.
 * @public
 */
export interface GenerationResult {
  code: string
  duration: number
  emptyUnionTypeNodesGenerated: number
  filesWithErrors: number
  outputSize: number
  queriesCount: number
  queryFilesCount: number
  schemaTypesCount: number
  typeNodesGenerated: number
  unknownTypeNodesGenerated: number
  unknownTypeNodesRatio: number
}

/**
 * A progress event emitted during a single typegen run.
 * Consumers (e.g. the Sanity CLI) render these; the library performs no terminal output.
 * @public
 */
export type TypegenProgressEvent =
  | {
      errors: string[]
      evaluatedFiles: number
      expectedFileCount: number
      queriesCount: number
      queryFilesCount: number
      type: 'moduleEvaluated'
    }
  | {expectedFileCount: number; type: 'typegenStarted'}
  | {formatterName: string; message: string; type: 'formatFailed'}
  | {formatterName: string; type: 'formatting'}
  | {result: GenerationResult; type: 'complete'}
  | {schemaTypesCount: number; type: 'schemaTypesGenerated'}
  | {type: 'schemaLoaded'}

/**
 * Options for running a single typegen generation.
 * @public
 */
export interface RunTypegenOptions {
  /** Working directory (usually project root) */
  workDir: string

  /** Typegen configuration */
  config?: Partial<TypeGenConfig>

  /**
   * An extracted schema to generate from, used instead of reading `config.schema` from disk.
   * Same shape as the output of `sanity schema extract`. Pass this when the schema is extracted
   * in memory, for example after fetching and compiling a dataset's schema, so it does not have
   * to be written to a temporary file first. The watcher then watches query files only.
   * @beta
   */
  extractedSchema?: SchemaType

  /** Optional progress reporter. Called synchronously as generation proceeds. */
  onProgress?: (event: TypegenProgressEvent) => void

  /**
   * Also register the generated types under this project and dataset. See
   * `GenerateTypesOptions.resource`.
   * @beta
   */
  resource?: TypegenResource
}
