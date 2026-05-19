import {type SchemaType} from 'groq-js'

import {goGenerator} from './go/index.js'
import {phpGenerator} from './php/index.js'
import {swiftGenerator} from './swift/index.js'
import {typescriptGenerator} from './typescript/index.js'

/** @public */
export type LanguageId = 'go' | 'php' | 'swift' | 'typescript'

/** @public */
export interface BaseLanguageConfig {
  generates: string
  schema: string

  formatGeneratedCode?: 'oxfmt' | 'prettier' | boolean
}

/** @public */
export interface GenerationStats {
  /** Language-specific extras. */
  [key: string]: unknown
  documents: number
  objects: number
  skipped: Array<{name: string; reason: string}>
}

/** @public */
export interface GenerationOutput {
  code: string
  stats: GenerationStats
}

/** @public */
export interface LanguageGenerator<Config extends BaseLanguageConfig = BaseLanguageConfig> {
  readonly fileExtension: string
  generate(args: {config: Config; schema: SchemaType; workDir: string}): Promise<GenerationOutput>
  readonly id: LanguageId
  parseConfig(raw: unknown): Config
}

/** @public */
export const POLYGLOT_API_VERSION = 1

/** @public */
export interface LanguageSupport {
  minVersion: number
}

/**
 * Languages currently supported by this build of `@sanity/codegen`. Entries are added
 * as each language generator lands.
 * @public
 */
export const polyglotSupport: Record<LanguageId, LanguageSupport> = {
  go: {minVersion: POLYGLOT_API_VERSION},
  php: {minVersion: POLYGLOT_API_VERSION},
  swift: {minVersion: POLYGLOT_API_VERSION},
  typescript: {minVersion: POLYGLOT_API_VERSION},
}

/**
 * Registry of available language generators, keyed by `LanguageId`. Each generator
 * landing in this file appends itself here; the orchestrator looks up generators
 * by id per configured language sub-block.
 * @public
 */
export const polyglotRegistry: Partial<Record<LanguageId, LanguageGenerator>> = {
  go: goGenerator,
  php: phpGenerator,
  swift: swiftGenerator,
  typescript: typescriptGenerator,
}
