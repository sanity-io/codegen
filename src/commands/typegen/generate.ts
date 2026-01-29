import {stat} from 'node:fs/promises'

import {Flags} from '@oclif/core'
import {SanityCommand} from '@sanity/cli-core'
import {chalk, spinner} from '@sanity/cli-core/ux'
import {omit, once} from 'lodash-es'

import {runTypegenGenerate} from '../../actions/typegenGenerate.js'
import {runTypegenWatcher} from '../../actions/typegenWatch.js'
import {configDefinition, readConfig, type TypeGenConfig} from '../../readConfig.js'
import {TypegenWatchModeTrace, TypesGeneratedTrace} from '../../typegen.telemetry.js'
import {promiseWithResolvers} from '../../utils/promiseWithResolvers.js'
import {telemetry} from '../../utils/telemetryLogger.js'

const description = `Sanity TypeGen (Beta)
This command is currently in beta and may undergo significant changes. Feedback is welcome!

${chalk.bold('Configuration:')}
This command can utilize configuration settings defined in a \`sanity-typegen.json\` file. These settings include:

- "path": Specifies a glob pattern to locate your TypeScript or JavaScript files.
  Default: "./src/**/*.{ts,tsx,js,jsx}"

- "schema": Defines the path to your Sanity schema file. This file should be generated using the \`sanity schema extract\` command.
  Default: "schema.json"

- "generates": Indicates the path where the generated TypeScript type definitions will be saved.
  Default: "./sanity.types.ts"

The default configuration values listed above are used if not overridden in your \`sanity-typegen.json\` configuration file. To customize the behavior of the type generation, adjust these properties in the configuration file according to your project's needs.

${chalk.bold('Note:')}
- The \`sanity schema extract\` command is a prerequisite for extracting your Sanity Studio schema into a \`schema.json\` file, which is then used by the \`sanity typegen generate\` command to generate type definitions.
- While this tool is in beta, we encourage you to experiment with these configurations and provide feedback to help improve its functionality and usability.`.trim()

/**
 * @internal
 */
export class TypegenGenerateCommand extends SanityCommand<typeof TypegenGenerateCommand> {
  static override description = description

  static override examples = [
    {
      command: '<%= config.bin %> <%= command.id %>',
      description: `Generate TypeScript type definitions from a Sanity Studio schema extracted using the \`sanity schema extract\` command.`,
    },
  ]

  static override flags = {
    'config-path': Flags.string({
      description:
        '[Default: sanity-typegen.json] Specifies the path to the typegen configuration file. This file should be a JSON file that contains settings for the type generation process.',
    }),
    watch: Flags.boolean({
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

  private async getConfig(): Promise<{
    config: TypeGenConfig
    path?: string
    type: 'cli' | 'legacy'
    workDir: string
  }> {
    const spin = spinner({}).start('Loading config…')

    const {flags} = await this.parse(TypegenGenerateCommand)
    const rootDir = await this.getProjectRoot()
    const config = await this.getCliConfig()

    const configPath = flags['config-path']
    const workDir = rootDir.directory

    // check if the legacy config exist
    const legacyConfigPath = configPath || 'sanity-typegen.json'
    let hasLegacyConfig = false
    try {
      const file = await stat(legacyConfigPath)
      hasLegacyConfig = file.isFile()
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT' && configPath) {
        throw new Error(`Typegen config file not found: ${configPath}`, {cause: err})
      }

      if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
        throw new Error(`Error when checking if typegen config file exists: ${legacyConfigPath}`, {
          cause: err,
        })
      }
    }

    // we have both legacy and cli config with typegen
    if (config?.typegen && hasLegacyConfig) {
      spin.warn(
        chalk.yellow(
          `You've specified typegen in your Sanity CLI config, but also have a typegen config.

  The config from the Sanity CLI config is used.
  `,
        ),
      )

      return {
        config: configDefinition.parse(config.typegen || {}),
        path: rootDir.path,
        type: 'cli',
        workDir,
      }
    }

    // we only have legacy typegen config
    if (hasLegacyConfig) {
      spin.warn(
        chalk.yellow(
          `The separate typegen config has been deprecated. Use \`typegen\` in the sanity CLI config instead.

  See: https://www.sanity.io/docs/help/configuring-typegen-in-sanity-cli-config`,
        ),
      )
      return {
        config: await readConfig(legacyConfigPath),
        path: legacyConfigPath,
        type: 'legacy',
        workDir,
      }
    }

    spin.succeed(`Config loaded from sanity.cli.ts`)

    // we only have cli config
    return {
      config: configDefinition.parse(config.typegen || {}),
      path: rootDir.path,
      type: 'cli',
      workDir,
    }
  }

  private async runSingle() {
    const trace = telemetry.trace(TypesGeneratedTrace)

    try {
      const {config: typegenConfig, type: typegenConfigMethod, workDir} = await this.getConfig()
      trace.start()

      const result = await runTypegenGenerate({
        config: typegenConfig,
        workDir,
      })

      const traceStats = omit(result, 'code', 'duration')

      trace.log({
        configMethod: typegenConfigMethod,
        configOverloadClientMethods: typegenConfig.overloadClientMethods,
        ...traceStats,
      })
      trace.complete()
    } catch (error) {
      trace.error(error as Error)
      trace.complete()

      this.error(`${error instanceof Error ? error.message : 'Unknown error'}`, {
        exit: 1,
      })
    }
  }

  private async runWatcher() {
    const trace = telemetry.trace(TypegenWatchModeTrace)

    try {
      const {config: typegenConfig, workDir} = await this.getConfig()
      trace.start()

      const {promise, resolve} = promiseWithResolvers()

      const typegenWatcher = runTypegenWatcher({
        config: typegenConfig,
        workDir,
      })

      const stop = once(async () => {
        process.off('SIGINT', stop)
        process.off('SIGTERM', stop)

        trace.log({
          step: 'stopped',
          ...typegenWatcher.getStats(),
        })

        await typegenWatcher.stop()
        resolve()
      })

      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)

      await promise
    } catch (error) {
      trace.error(error as Error)
      trace.complete()

      this.error(`${error instanceof Error ? error.message : 'Unknown error'}`, {
        exit: 1,
      })
    }
  }
}
