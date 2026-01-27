import {mkdir, stat, writeFile} from 'node:fs/promises'
import {dirname, isAbsolute, join} from 'node:path'
import {env} from 'node:process'
import {Worker} from 'node:worker_threads'

import {Flags} from '@oclif/core'
import {SanityCommand, subdebug} from '@sanity/cli-core'
import {chalk, spinner} from '@sanity/cli-core/ux'
import {WorkerChannelReceiver} from '@sanity/worker-channels'

import {generatedFileWarning} from '../../actions/generatedFileWarning.js'
import {
  type TypegenGenerateTypesWorkerData,
  type TypegenWorkerChannel,
} from '../../actions/types.js'
import {configDefinition, readConfig, type TypeGenConfig} from '../../readConfig.js'
import {count} from '../../utils/count.js'
import {formatPath} from '../../utils/formatPath.js'
import {getMessage} from '../../utils/getMessage.js'
import {percent} from '../../utils/percent.js'

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

const debug = subdebug('typegen:generate')

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
  }

  public async run() {
    const {flags} = await this.parse(TypegenGenerateCommand)
    const workDir = (await this.getProjectRoot()).directory

    // TODO: Add telemetry
    //   const trace = telemetry.trace(TypesGeneratedTrace)
    // trace.start()

    const spin = spinner({}).start('Loading config…')

    let typegenConfig: TypeGenConfig
    let configPath: string | undefined
    let typegenConfigMethod: 'cli' | 'legacy'

    try {
      const result = await this.getConfig(spin, flags['config-path'])
      typegenConfig = result.config
      configPath = result.path
      typegenConfigMethod = result.type

      spin.succeed(`Config loaded from ${formatPath(configPath?.replace(workDir, '.') ?? '')}`)
    } catch (error) {
      debug('error loading config', error)
      spin.fail()
      this.error(`${error instanceof Error ? error.message : 'Unknown error'}`, {
        exit: 1,
      })
    }

    const {
      formatGeneratedCode,
      generates,
      overloadClientMethods,
      path: searchPath,
      schema: schemaPath,
    } = typegenConfig

    const outputPath = isAbsolute(typegenConfig.generates)
      ? typegenConfig.generates
      : join(workDir, typegenConfig.generates)

    const outputDir = dirname(outputPath)
    await mkdir(outputDir, {recursive: true})

    const workerPath = new URL('../../actions/typegenGenerate.worker.js', import.meta.url)
    const workerData: TypegenGenerateTypesWorkerData = {
      overloadClientMethods,
      schemaPath,
      searchPath,
      workDir,
    }

    const worker = new Worker(workerPath, {env, workerData})
    const receiver = WorkerChannelReceiver.from<TypegenWorkerChannel>(worker)

    try {
      spin.start(`Loading schema…`)
      await receiver.event.loadedSchema()
      spin.succeed(`Schema loaded from ${formatPath(schemaPath ?? '')}`)

      spin.start('Generating schema types…')
      const {expectedFileCount} = await receiver.event.typegenStarted()
      const {schemaTypeDeclarations} = await receiver.event.generatedSchemaTypes()
      const schemaTypesCount = schemaTypeDeclarations.length
      spin.succeed(`Generated ${count(schemaTypesCount, 'schema types')}`)

      spin.start('Generating query types…')
      let queriesCount = 0
      let evaluatedFiles = 0
      let filesWithErrors = 0
      let queryFilesCount = 0
      let typeNodesGenerated = 0
      let unknownTypeNodesGenerated = 0
      let emptyUnionTypeNodesGenerated = 0

      for await (const {errors, queries} of receiver.stream.evaluatedModules()) {
        evaluatedFiles++
        queriesCount += queries.length
        queryFilesCount += queries.length > 0 ? 1 : 0
        filesWithErrors += errors.length > 0 ? 1 : 0

        for (const {stats} of queries) {
          typeNodesGenerated += stats.allTypes
          unknownTypeNodesGenerated += stats.unknownTypes
          emptyUnionTypeNodesGenerated += stats.emptyUnions
        }

        for (const error of errors) {
          spin.fail(getMessage(error))
        }

        spin.text =
          `Generating query types… (${percent(evaluatedFiles / expectedFileCount)})\n` +
          `  └─ Processed ${count(evaluatedFiles)} of ${count(expectedFileCount, 'files')}. ` +
          `Found ${count(queriesCount, 'queries', 'query')} from ${count(queryFilesCount, 'files')}.`
      }

      const result = await receiver.event.typegenComplete()
      const code = `${generatedFileWarning}${result.code}`
      await writeFile(outputPath, code)

      spin.succeed(
        `Generated ${count(queriesCount, 'query types')} from ${count(queryFilesCount, 'files')} out of ${count(evaluatedFiles, 'scanned files')}`,
      )

      if (formatGeneratedCode) {
        spin.start(`Formatting generated types with prettier…`)

        try {
          const prettier = await import('prettier')
          const prettierConfig = await prettier.resolveConfig(outputPath)
          const formattedCode = await prettier.format(code, {
            ...prettierConfig,
            parser: 'typescript' as const,
          })
          await writeFile(outputPath, formattedCode)

          spin.succeed('Formatted generated types with prettier')
        } catch (err) {
          spin.warn(`Failed to format generated types with prettier: ${getMessage(err)}`)
        }
      }

      debug('trace', {
        configMethod: typegenConfigMethod,
        configOverloadClientMethods: overloadClientMethods,
        emptyUnionTypeNodesGenerated,
        filesWithErrors,
        outputSize: Buffer.byteLength(result.code),
        queriesCount,
        queryFilesCount,
        schemaTypesCount,
        typeNodesGenerated,
        unknownTypeNodesGenerated,
        unknownTypeNodesRatio:
          typeNodesGenerated > 0 ? unknownTypeNodesGenerated / typeNodesGenerated : 0,
      })
      // trace.log({
      //   configMethod: typegenConfigMethod,
      //   configOverloadClientMethods: overloadClientMethods,
      //   emptyUnionTypeNodesGenerated,
      //   filesWithErrors,
      //   outputSize: Buffer.byteLength(result.code),
      //   queriesCount,
      //   queryFilesCount,
      //   schemaTypesCount,
      //   typeNodesGenerated,
      //   unknownTypeNodesGenerated,
      //   unknownTypeNodesRatio:
      //     typeNodesGenerated > 0 ? unknownTypeNodesGenerated / typeNodesGenerated : 0,
      // })

      if (filesWithErrors > 0) {
        spin.warn(`Encountered errors in ${count(filesWithErrors, 'files')} while generating types`)
      }

      spin.succeed(`Successfully generated types to ${formatPath(generates)}`)
    } catch (err) {
      // trace.error(err)
      debug('error generating types', err)
      this.error(err instanceof Error ? err.message : 'Unknown error', {exit: 1})
    } finally {
      receiver.unsubscribe()
      // trace.complete()
      await worker.terminate()
    }
  }

  private async getConfig(
    spin: ReturnType<typeof spinner>,
    configPath?: string,
  ): Promise<{config: TypeGenConfig; path?: string; type: 'cli' | 'legacy'}> {
    const rootDir = await this.getProjectRoot()
    const config = await this.getCliConfig()

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
      }
    }

    // we only have cli config
    return {
      config: configDefinition.parse(config.typegen || {}),
      path: rootDir.path,
      type: 'cli',
    }
  }
}
