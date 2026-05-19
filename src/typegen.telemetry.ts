import {defineTrace} from '@sanity/telemetry'

interface PerLanguageStats {
  documents: number
  durationMs: number
  objects: number
  skipped: number
  status: 'error' | 'success'
}

interface TypeScriptLanguageStats extends PerLanguageStats {
  configOverloadClientMethods: boolean
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

interface TypesGeneratedTraceAttributes {
  configMethod: 'cli' | 'legacy'
  languages: {
    go?: PerLanguageStats
    php?: PerLanguageStats
    swift?: PerLanguageStats
    typescript?: TypeScriptLanguageStats
  }
}

/** @public */
export const TypesGeneratedTrace = defineTrace<TypesGeneratedTraceAttributes>({
  description: 'Trace emitted when generating types from a Sanity schema',
  name: 'Types Generated',
  version: 1,
})

/**
 * Attributes for typegen watch mode trace - tracks the start and stop of watch mode
 * sessions with statistics about generation runs.
 */
export type TypegenWatchModeTraceAttributes =
  | {
      averageGenerationDuration: number
      generationFailedCount: number
      generationSuccessfulCount: number
      step: 'stopped'
      watcherDuration: number
    }
  | {
      step: 'started'
    }

/** @public */
export const TypegenWatchModeTrace = defineTrace<TypegenWatchModeTraceAttributes>({
  description: 'Trace emitted when typegen watch mode is run',
  name: 'Typegen Watch Mode Started',
  version: 0,
})
