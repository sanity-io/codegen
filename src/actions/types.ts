import {spinner} from '@sanity/cli-core/ux'
import {WorkerChannel} from '@sanity/worker-channels'

import {type GenerationOutput, type LanguageId} from '../polyglot/index.js'
import {type TypegenWorkerChannel as CodegenTypegenWorkerChannel} from '../polyglot/typescript/typeGenerator.js'
import {type TypeGenConfig, type TypegenConfigInput} from '../readConfig.js'

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
 * @public
 */
export interface RunTypegenOptions {
  /** Working directory (usually project root) */
  workDir: string

  /**
   * Typegen configuration. Accepts the legacy flat shape, the new per-language nested
   * shape, or a fully-parsed legacy `TypeGenConfig` (treated as the TypeScript block).
   */
  config?: Partial<TypeGenConfig> | TypegenConfigInput

  /** Optional spinner instance for progress display */
  spin?: ReturnType<typeof spinner>
}

/**
 * Result of one language generator's run within a single `runTypegenGenerate` call.
 * @public
 */
export interface LanguageRunResult {
  /** Time spent in this language's generator, in ms. */
  duration: number
  outputPath: string
  schemaPath: string
  status: 'error' | 'success'

  error?: {cause?: unknown; message: string}
  stats?: GenerationOutput['stats'] & Record<string, unknown>
}

/**
 * Result from a single generation run across all configured languages.
 * @public
 */
export interface GenerationResult {
  /** Total wall-clock time across all languages, in ms. */
  duration: number

  /** Per-language results, keyed by `LanguageGenerator.id`. */
  languages: Partial<Record<LanguageId, LanguageRunResult>>
}
