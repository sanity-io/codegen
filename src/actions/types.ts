import {WorkerChannel} from '@sanity/worker-channels'

import {TypeGenConfig} from '../readConfig.js'
import {type TypegenWorkerChannel as CodegenTypegenWorkerChannel} from '../typescript/typeGenerator.js'

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

  /** Whether to generate client method overloads */
  overloadClientMethods?: boolean
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
  | {type: 'schemaLoaded'}
  | {type: 'typegenStarted'; expectedFileCount: number}
  | {type: 'schemaTypesGenerated'; schemaTypesCount: number}
  | {
      type: 'moduleEvaluated'
      evaluatedFiles: number
      expectedFileCount: number
      queriesCount: number
      queryFilesCount: number
      errors: string[]
    }
  | {type: 'formatting'; formatterName: string}
  | {type: 'formatFailed'; formatterName: string; message: string}
  | {type: 'complete'; result: GenerationResult}

/**
 * Options for running a single typegen generation.
 * @public
 */
export interface RunTypegenOptions {
  /** Working directory (usually project root) */
  workDir: string

  /** Typegen configuration */
  config?: Partial<TypeGenConfig>

  /** Optional progress reporter. Called synchronously as generation proceeds. */
  onProgress?: (event: TypegenProgressEvent) => void
}
