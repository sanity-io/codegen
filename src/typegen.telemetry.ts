import {defineTrace} from '@sanity/telemetry'

interface TypesGeneratedTraceAttributes {
  configMethod: 'cli' | 'legacy'
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

export const TypesGeneratedTrace = defineTrace<TypesGeneratedTraceAttributes>({
  description: 'Trace emitted when generating TypeScript types for queries',
  name: 'Types Generated',
  version: 0,
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

export const TypegenWatchModeTrace = defineTrace<TypegenWatchModeTraceAttributes>({
  description: 'Trace emitted when typegen watch mode is run',
  name: 'Typegen Watch Mode Started',
  version: 0,
})
