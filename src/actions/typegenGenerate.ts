import {mkdir, stat, writeFile} from 'node:fs/promises'
import {dirname, isAbsolute, join} from 'node:path'

import {
  type BaseLanguageConfig,
  type LanguageGenerator,
  type LanguageId,
  POLYGLOT_API_VERSION,
  polyglotRegistry,
  polyglotSupport,
} from '../polyglot/index.js'
import {detectTypegenConflict, type FormatGeneratedCode, parseTypegenConfig} from '../readConfig.js'
import {readSchema} from '../readSchema.js'
import {debug} from '../utils/debug.js'
import {defineFormatter} from '../utils/resolveFormatter.js'
import {type GenerationResult, type LanguageRunResult, type RunTypegenOptions} from './types.js'

/**
 * Progress event surfaced by the orchestrator for the CLI spinner. One event per language
 * is emitted as soon as that language's generator finishes (success or failure), so the
 * CLI can render per-language rows independently (FR-018).
 * @internal
 */
export interface LanguageProgressEvent {
  id: LanguageId
  outputPath: string
  status: 'error' | 'success'

  error?: LanguageRunResult['error']
  stats?: LanguageRunResult['stats']
}

/**
 * Result of the orchestrator's pre-emission validation pipeline. The CLI awaits this
 * before any spinner work begins so that misconfiguration surfaces under 1 second (SC-006).
 * @internal
 */
interface PreparedLanguage<Config extends BaseLanguageConfig = BaseLanguageConfig> {
  config: Config
  generator: LanguageGenerator<Config>
  id: LanguageId
  outputPath: string
  schemaPath: string
}

interface PrepareResult {
  prepared: PreparedLanguage[]
  warnings: string[]
}

async function prepareLanguages(rawTypegen: unknown, workDir: string): Promise<PrepareResult> {
  // Step 1: zod-level shape check happens at the cli-core layer; here we treat the
  //         input as already-shape-validated and only enforce the polyglot rules.
  // Step 2: legacy vs new conflict (FR-005).
  detectTypegenConflict(rawTypegen)
  const parsed = parseTypegenConfig(rawTypegen)

  if (parsed.form === 'empty') {
    return {prepared: [], warnings: parsed.warnings}
  }

  const prepared: PreparedLanguage[] = []
  const orderedIds = Object.keys(parsed.languages) as LanguageId[]

  // Step 6 (early): version-compat check before invoking any generator.
  for (const id of orderedIds) {
    const support = polyglotSupport[id]
    if (!support) {
      throw new Error(
        `'${id}' generation is not supported by this version of @sanity/codegen ` +
          `(POLYGLOT_API_VERSION=${POLYGLOT_API_VERSION}). Run: pnpm add @sanity/codegen@latest`,
      )
    }
    const generator = polyglotRegistry[id]
    if (!generator) {
      throw new Error(
        `'${id}' generation requires @sanity/codegen >= ${support.minVersion} but the installed ` +
          `version does not register a '${id}' generator. Run: pnpm add @sanity/codegen@latest`,
      )
    }
  }

  // Step 3: per-language parseConfig.
  for (const id of orderedIds) {
    const generator = polyglotRegistry[id]!
    const rawBlock = parsed.languages[id]
    let config: BaseLanguageConfig
    try {
      config = generator.parseConfig(rawBlock)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // parseConfig is expected to prefix its own messages with `${id} config:`; pass through.
      throw new Error(msg, {cause: err})
    }
    const schemaPath = isAbsolute(config.schema) ? config.schema : join(workDir, config.schema)
    const outputPath = isAbsolute(config.generates)
      ? config.generates
      : join(workDir, config.generates)
    prepared.push({config, generator, id, outputPath, schemaPath})
  }

  // Step 4: output-path uniqueness (FR-016).
  const byOutput = new Map<string, LanguageId[]>()
  for (const p of prepared) {
    const list = byOutput.get(p.outputPath) ?? []
    list.push(p.id)
    byOutput.set(p.outputPath, list)
  }
  for (const [path, ids] of byOutput) {
    if (ids.length > 1) {
      throw new Error(`multiple languages emit to ${path}: ${ids.join(', ')}`)
    }
  }

  // Step 5: schema-file existence and readability (FR-020).
  const uniqueSchemas = [...new Set(prepared.map((p) => p.schemaPath))]
  await Promise.all(
    uniqueSchemas.map(async (schemaPath) => {
      try {
        const stats = await stat(schemaPath)
        if (!stats.isFile()) {
          const id = prepared.find((p) => p.schemaPath === schemaPath)!.id
          throw new Error(`${id} config: schema path is not a file: ${schemaPath}`)
        }
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          const id = prepared.find((p) => p.schemaPath === schemaPath)!.id
          throw new Error(`${id} config: schema file not found: ${schemaPath}`, {cause: err})
        }
        throw err
      }
    }),
  )

  return {prepared, warnings: parsed.warnings}
}

/**
 * Runs typegen across every configured language.
 *
 * Iterates languages in declaration order (sequential, R8), shares one parsed schema
 * across languages that point at the same file (R7), wraps each generator in its own
 * try/catch so a failure in one language does not abort the others (FR-017), and writes
 * each generator's `code` to its configured `generates` path. The pre-emission
 * validation pipeline runs before any file is written (SC-006).
 *
 * @public
 */
export async function runTypegenGenerate(
  options: RunTypegenOptions & {
    onLanguageProgress?: (event: LanguageProgressEvent) => void
    onWarning?: (warning: string) => void
  },
): Promise<GenerationResult> {
  const {config, onLanguageProgress, onWarning, workDir} = options

  const start = Date.now()
  const languages: Partial<Record<LanguageId, LanguageRunResult>> = {}

  const {prepared, warnings} = await prepareLanguages(config, workDir)
  if (onWarning) {
    for (const w of warnings) onWarning(w)
  }

  // Cache schemas read from disk (R7) so the same file is not parsed twice when two
  // languages point at the same `schema` path.
  const schemaCache = new Map<string, Awaited<ReturnType<typeof readSchema>>>()
  const getSchema = async (schemaPath: string) => {
    let cached = schemaCache.get(schemaPath)
    if (!cached) {
      cached = await readSchema(schemaPath)
      schemaCache.set(schemaPath, cached)
    }
    return cached
  }

  for (const {config: parsedConfig, generator, id, outputPath, schemaPath} of prepared) {
    const langStart = Date.now()
    try {
      const schema = await getSchema(schemaPath)
      const output = await generator.generate({
        config: parsedConfig,
        schema,
        workDir,
      })

      await mkdir(dirname(outputPath), {recursive: true})
      await writeFile(outputPath, output.code)

      // Apply the per-language formatter when requested. Formatter failures degrade
      // gracefully — the unformatted file is left in place and a warning is surfaced.
      const fmt: FormatGeneratedCode = parsedConfig.formatGeneratedCode ?? true
      const formatter = defineFormatter(fmt)
      if (formatter) {
        try {
          const {format} = await formatter.resolve()
          if (format) {
            const formatted = await format(outputPath, output.code)
            await writeFile(outputPath, formatted)
          }
        } catch (err) {
          debug('format error for %s: %O', id, err)
          onWarning?.(
            `Failed to format ${id} output with ${formatter.name}: ` +
              (err instanceof Error ? err.message : String(err)),
          )
        }
      }

      const result: LanguageRunResult = {
        duration: Date.now() - langStart,
        outputPath,
        schemaPath,
        stats: output.stats,
        status: 'success',
      }
      languages[id] = result
      onLanguageProgress?.({
        id,
        outputPath,
        stats: output.stats,
        status: 'success',
      })
    } catch (err) {
      debug('error generating types for %s: %O', id, err)
      const message = err instanceof Error ? err.message : String(err)
      const result: LanguageRunResult = {
        duration: Date.now() - langStart,
        error: {cause: err, message},
        outputPath,
        schemaPath,
        status: 'error',
      }
      languages[id] = result
      onLanguageProgress?.({
        error: result.error,
        id,
        outputPath,
        status: 'error',
      })
    }
  }

  return {duration: Date.now() - start, languages}
}
