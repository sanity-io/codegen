import {stat} from 'node:fs/promises'
import {styleText} from 'node:util'

import {Flags} from '@oclif/core'
import {SanityCommand} from '@sanity/cli-core'
import {spinner} from '@sanity/cli-core/ux'
import once from 'lodash-es/once.js'

import {type LanguageProgressEvent, runTypegenGenerate} from '../../actions/typegenGenerate.js'
import {runTypegenWatcher} from '../../actions/typegenWatch.js'
import {type LanguageId} from '../../polyglot/index.js'
import {readConfig, type TypegenConfigInput} from '../../readConfig.js'
import {TypegenWatchModeTrace, TypesGeneratedTrace} from '../../typegen.telemetry.js'
import {debug} from '../../utils/debug.js'
import {formatPath} from '../../utils/formatPath.js'
import {promiseWithResolvers} from '../../utils/promiseWithResolvers.js'

const description = `Sanity TypeGen

${styleText('bold', 'Configuration:')}
Configure typegen under the \`typegen\` field of \`sanity.cli.ts\`. Each target language has its
own sub-block:

- typegen.typescript: { schema, generates, path?, overloadClientMethods?, formatGeneratedCode? }
- typegen.go:         { schema, generates, packageName?, formatGeneratedCode? }
- typegen.php:        { schema, generates, namespace?, formatGeneratedCode? }
- typegen.swift:      { schema, generates, formatGeneratedCode? }

Every sub-block is optional. The legacy flat \`typegen: {schema, generates, ...}\` shape is
still accepted and prints a one-line deprecation warning.

${styleText('bold', 'Note:')}
- The \`sanity schema extract\` command is a prerequisite — it writes the \`schema.json\` file
  that this command reads.`.trim()

interface ConfigLoad {
  configMethod: 'cli' | 'legacy'
  raw: TypegenConfigInput | undefined
  workDir: string
}

/**
 * @internal
 */
export class TypegenGenerateCommand extends SanityCommand<typeof TypegenGenerateCommand> {
  static override description = description

  static override examples = [
    {
      command: '<%= config.bin %> <%= command.id %>',
      description: `Generate type definitions from a Sanity Studio schema extracted using the \`sanity schema extract\` command.`,
    },
  ]

  static override flags = {
    'config-path': Flags.string({
      description:
        '[Default: sanity-typegen.json] Specifies the path to the typegen configuration file. This file should be a JSON file that contains settings for the type generation process.',
    }),
    watch: Flags.boolean({
      default: false,
      description: '[Default: false] Run the typegen in watch mode',
    }),
  }

  public async run() {
    const {flags} = await this.parse(TypegenGenerateCommand)
    if (flags.watch) {
      await this.runWatcher()
      return
    }
    await this.runSingle()
  }

  private async getConfig(): Promise<ConfigLoad> {
    const spin = spinner({}).start('Loading config…')
    try {
      const {flags} = await this.parse(TypegenGenerateCommand)
      const rootDir = await this.getProjectRoot()
      const cliConfig = await this.getCliConfig()

      const configPath = flags['config-path']
      const workDir = rootDir.directory

      const legacyConfigPath = configPath || 'sanity-typegen.json'
      let hasLegacyConfig = false
      try {
        const file = await stat(legacyConfigPath)
        hasLegacyConfig = file.isFile()
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT' && configPath) {
          spin.fail()
          this.error(`Typegen config file not found: ${configPath}`, {exit: 1})
        }
        if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
          spin.fail()
          this.error(`Error when checking if typegen config file exists: ${legacyConfigPath}`, {
            exit: 1,
          })
        }
      }

      if (cliConfig?.typegen && hasLegacyConfig) {
        spin.warn(
          styleText(
            'yellow',
            `You've specified typegen in your Sanity CLI config, but also have a typegen config.\n    The config from the Sanity CLI config is used.\n`,
          ),
        )
        return {
          configMethod: 'cli',
          raw: cliConfig.typegen as TypegenConfigInput,
          workDir,
        }
      }

      if (hasLegacyConfig) {
        spin.warn(
          styleText(
            'yellow',
            `The separate typegen config has been deprecated. Use \`typegen\` in the sanity CLI config instead.\n    See: https://www.sanity.io/docs/help/configuring-typegen-in-sanity-cli-config`,
          ),
        )
        return {
          configMethod: 'legacy',
          raw: (await readConfig(legacyConfigPath)) as TypegenConfigInput,
          workDir,
        }
      }

      spin.succeed(`Config loaded from sanity.cli.ts`)
      return {
        configMethod: 'cli',
        raw: (cliConfig.typegen as TypegenConfigInput) ?? undefined,
        workDir,
      }
    } catch (err) {
      spin.fail()
      this.error(`An error occured during config loading ${err}`, {exit: 1})
    }
  }

  private async runSingle() {
    const trace = this.telemetry.trace(TypesGeneratedTrace)
    try {
      const {configMethod, raw, workDir} = await this.getConfig()
      trace.start()

      const spinners = new Map<LanguageId, ReturnType<typeof spinner>>()
      const ensureSpinner = (id: LanguageId): ReturnType<typeof spinner> => {
        const existing = spinners.get(id)
        if (existing) return existing
        const sp = spinner({}).start(`${id}…`)
        spinners.set(id, sp)
        return sp
      }

      const renderProgress = (event: LanguageProgressEvent) => {
        const sp = ensureSpinner(event.id)
        if (event.status === 'success') {
          const stats = event.stats
          const docs = typeof stats?.documents === 'number' ? stats.documents : 0
          const objs = typeof stats?.objects === 'number' ? stats.objects : 0
          sp.succeed(
            `${event.id} → ${formatPath(event.outputPath)}  (${docs} documents, ${objs} objects)`,
          )
        } else {
          sp.fail(`${event.id} ${event.error?.message ?? 'unknown error'}`)
        }
      }

      const result = await runTypegenGenerate({
        config: raw,
        onLanguageProgress: renderProgress,
        onWarning: (warning) => this.log(styleText('yellow', `warn  ${warning}`)),
        workDir,
      })

      const total = Object.values(result.languages)
      const failed = total.filter((r) => r?.status === 'error')

      if (result.languages.swift?.status === 'success') {
        this.log(
          styleText(
            'dim',
            `  note  Swift output uses 'import Sanity'. Add sanity-io/swift-sanity to your SwiftPM dependencies.`,
          ),
        )
      }

      if (failed.length > 0) {
        const failedIds = (
          Object.entries(result.languages) as Array<[LanguageId, (typeof total)[number]]>
        )
          .filter(([, r]) => r?.status === 'error')
          .map(([id]) => id)
          .join(', ')
        this.log(
          styleText(
            'red',
            `\n${failed.length} of ${total.length} language(s) failed: ${failedIds}`,
          ),
        )
      }

      // Telemetry: per-language sub-object, no schema or field names.
      const langTrace: Record<string, unknown> = {}
      const tsResult = result.languages.typescript
      if (tsResult) {
        const tsStats = (tsResult.stats ?? {}) as Record<string, unknown>
        langTrace.typescript = {
          configOverloadClientMethods: Boolean(
            (raw as Record<string, unknown> | undefined)?.overloadClientMethods ??
            (raw as {typescript?: {overloadClientMethods?: boolean}} | undefined)?.typescript
              ?.overloadClientMethods ??
            true,
          ),
          documents: typeof tsStats.documents === 'number' ? tsStats.documents : 0,
          durationMs: tsResult.duration,
          emptyUnionTypeNodesGenerated: Number(tsStats.emptyUnionTypeNodesGenerated ?? 0),
          filesWithErrors: Number(tsStats.filesWithErrors ?? 0),
          objects: typeof tsStats.objects === 'number' ? tsStats.objects : 0,
          outputSize: Number(tsStats.outputSize ?? 0),
          queriesCount: Number(tsStats.queriesCount ?? 0),
          queryFilesCount: Number(tsStats.queryFilesCount ?? 0),
          schemaTypesCount: Number(tsStats.schemaTypesCount ?? 0),
          skipped: Array.isArray(tsStats.skipped) ? tsStats.skipped.length : 0,
          status: tsResult.status,
          typeNodesGenerated: Number(tsStats.typeNodesGenerated ?? 0),
          unknownTypeNodesGenerated: Number(tsStats.unknownTypeNodesGenerated ?? 0),
          unknownTypeNodesRatio:
            Number(tsStats.typeNodesGenerated ?? 0) > 0
              ? Number(tsStats.unknownTypeNodesGenerated ?? 0) /
                Number(tsStats.typeNodesGenerated ?? 0)
              : 0,
        }
      }
      for (const id of ['go', 'php', 'swift'] as const) {
        const r = result.languages[id]
        if (!r) continue
        const stats = (r.stats ?? {}) as Record<string, unknown>
        langTrace[id] = {
          documents: typeof stats.documents === 'number' ? stats.documents : 0,
          durationMs: r.duration,
          objects: typeof stats.objects === 'number' ? stats.objects : 0,
          skipped: Array.isArray(stats.skipped) ? stats.skipped.length : 0,
          status: r.status,
        }
      }

      trace.log({
        configMethod,
        languages: langTrace as Parameters<typeof trace.log>[0]['languages'],
      })
      trace.complete()

      if (failed.length > 0) {
        this.exit(1)
      }
    } catch (error) {
      debug(error)
      trace.error(error as Error)
      this.error(`${error instanceof Error ? error.message : 'Unknown error'}`, {exit: 1})
    }
  }

  private async runWatcher() {
    const trace = this.telemetry.trace(TypegenWatchModeTrace)
    try {
      const {raw, workDir} = await this.getConfig()
      trace.start()

      const {promise, resolve} = promiseWithResolvers()

      const typegenWatcher = runTypegenWatcher({
        config: raw,
        workDir,
      })

      const stop = once(async () => {
        process.off('SIGINT', stop)
        process.off('SIGTERM', stop)
        trace.log({
          step: 'stopped',
          ...typegenWatcher.getStats(),
        })
        trace.complete()
        await typegenWatcher.stop()
        resolve()
      })

      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)

      await promise
    } catch (error) {
      debug(error)
      trace.error(error as Error)
      this.error(`${error instanceof Error ? error.message : 'Unknown error'}`, {exit: 1})
    }
  }
}
