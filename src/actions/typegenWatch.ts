import {error, log} from 'node:console'
import {isAbsolute, join, relative} from 'node:path'

import {chalk} from '@sanity/cli-core/ux'
import chokidar, {FSWatcher} from 'chokidar'
import {debounce, mean} from 'lodash-es'

import {TypegenWatchModeTraceAttributes} from '../typegen.telemetry.js'
import {prepareConfig} from '../utils/config.js'
import {runTypegenGenerate} from './typegenGenerate.js'
import {type RunTypegenOptions} from './types.js'

const IGNORED_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/lib/**',
  '**/.sanity/**',
]

/** State for tracking generation status */
export interface WatchState {
  isGenerating: boolean
  pendingGeneration: boolean
}

/** Return type for createTypegenRunner */
interface TypegenRunner {
  runGeneration: () => Promise<void>
  state: WatchState
}

type WatcherStats = Omit<Extract<TypegenWatchModeTraceAttributes, {step: 'stopped'}>, 'step'>

/**
 * Creates a typegen runner with concurrency control.
 * If generation is already running, queues one more generation to run after completion.
 * Multiple queued requests are coalesced into a single pending generation.
 */
export function createTypegenRunner(onGenerate: () => Promise<unknown>): TypegenRunner {
  const state: WatchState = {
    isGenerating: false,
    pendingGeneration: false,
  }

  async function runGeneration(): Promise<void> {
    if (state.isGenerating) {
      state.pendingGeneration = true
      return
    }

    state.isGenerating = true
    state.pendingGeneration = false

    try {
      await onGenerate()
    } finally {
      state.isGenerating = false

      // If a change came in during generation, run again
      if (state.pendingGeneration) {
        state.pendingGeneration = false
        await runGeneration()
      }
    }
  }

  return {runGeneration, state}
}

/**
 * Starts a file watcher that triggers typegen on changes.
 * Watches both query files (via patterns) and the schema JSON file.
 * Implements debouncing and concurrency control to prevent multiple generations.
 */
export function runTypegenWatcher(options: RunTypegenOptions): {
  getStats: () => WatcherStats
  stop: () => Promise<void>
  watcher: FSWatcher
} {
  const {config, workDir} = options
  const {path, schema} = prepareConfig(config)

  const stats = {
    failedCount: 0,
    startTime: Date.now(),
    successfulDurations: [] as number[],
  }

  const {runGeneration} = createTypegenRunner(async () => {
    try {
      const {duration} = await runTypegenGenerate({...options})
      stats.successfulDurations.push(duration)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : err
      console.error(` ${chalk.red('›')}   ${errorMessage}`)
      stats.failedCount++
    }
  })

  // Debounced generation trigger
  const debouncedGenerate = debounce(runGeneration, 1000)

  // Build absolute patterns for query files and schema file
  const paths = Array.isArray(path) ? path : [path]
  const absoluteQueryPatterns = paths.map((pattern) =>
    isAbsolute(pattern) ? pattern : join(workDir, pattern),
  )
  const absoluteSchemaPath = isAbsolute(schema) ? schema : join(workDir, schema)
  const watchTargets = [...absoluteQueryPatterns, absoluteSchemaPath]

  // perform initial generation
  debouncedGenerate()

  // set up watcher
  const watcher = chokidar.watch(watchTargets, {
    cwd: workDir,
    ignored: IGNORED_PATTERNS,
    ignoreInitial: true,
  })

  watcher.on('all', (event: string, filePath: string) => {
    const timestamp = new Date().toLocaleTimeString()
    const relativePath = isAbsolute(filePath) ? relative(workDir, filePath) : filePath
    log(`[${timestamp}] ${event}: ${relativePath}`)
    debouncedGenerate()
  })

  watcher.on('error', (err: Error) => {
    error(`Watcher error: ${err.message}`)
  })

  return {
    getStats: () => ({
      averageGenerationDuration: mean(stats.successfulDurations) || 0,
      generationFailedCount: stats.failedCount,
      generationSuccessfulCount: stats.successfulDurations.length,
      watcherDuration: Date.now() - stats.startTime,
    }),
    stop: async () => {
      await watcher.close()
    },
    watcher,
  }
}
