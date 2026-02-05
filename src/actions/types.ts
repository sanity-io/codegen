import {spinner} from '@sanity/cli-core/ux'
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
 * Options for running a single typegen generation.
 * This is the programmatic API for one-off generation without file watching.
 */
export interface RunTypegenOptions {
  /** Working directory (usually project root) */
  workDir: string

  /** Typegen configuration */
  config?: Partial<TypeGenConfig>

  /** Optional spinner instance for progress display */
  spin?: ReturnType<typeof spinner>
}

/**
 * Result from a single generation run.
 * @internal
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
