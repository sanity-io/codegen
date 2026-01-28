import {existsSync} from 'node:fs'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {runCommand} from '@oclif/test'
import {testCommand, testExample} from '@sanity/cli-test'
import {describe, expect, test} from 'vitest'

import {TypegenGenerateCommand} from '../generate.js'

describe('#typegen:generate', () => {
  test('should print help', async () => {
    const {stdout} = await runCommand('typegen generate --help')

    expect(stdout).toMatchInlineSnapshot(`
      "Sanity TypeGen (Beta)

      USAGE
        $ sanity typegen generate [--config-path <value>] [--watch]

      FLAGS
        --config-path=<value>  [Default: sanity-typegen.json] Specifies the path to
                               the typegen configuration file. This file should be a
                               JSON file that contains settings for the type
                               generation process.
        --watch                [Default: false] Run the typegen in watch mode

      DESCRIPTION
        Sanity TypeGen (Beta)
        This command is currently in beta and may undergo significant changes.
        Feedback is welcome!

        Configuration:
        This command can utilize configuration settings defined in a
        \`sanity-typegen.json\` file. These settings include:

        - "path": Specifies a glob pattern to locate your TypeScript or JavaScript
        files.
        Default: "./src/**/*.{ts,tsx,js,jsx}"

        - "schema": Defines the path to your Sanity schema file. This file should be
        generated using the \`sanity schema extract\` command.
        Default: "schema.json"

        - "generates": Indicates the path where the generated TypeScript type
        definitions will be saved.
        Default: "./sanity.types.ts"

        The default configuration values listed above are used if not overridden in
        your \`sanity-typegen.json\` configuration file. To customize the behavior of
        the type generation, adjust these properties in the configuration file
        according to your project's needs.

        Note:
        - The \`sanity schema extract\` command is a prerequisite for extracting your
        Sanity Studio schema into a \`schema.json\` file, which is then used by the
        \`sanity typegen generate\` command to generate type definitions.
        - While this tool is in beta, we encourage you to experiment with these
        configurations and provide feedback to help improve its functionality and
        usability.

      EXAMPLES
        Generate TypeScript type definitions from a Sanity Studio schema extracted
        using the \`sanity schema extract\` command.

          $ sanity typegen generate

      "
    `)
  })

  test('should error when no extracted schema is found', async () => {
    const cwd = await testExample('basic-studio')
    process.chdir(cwd)

    const {error} = await testCommand(TypegenGenerateCommand, [])

    expect(error).toBeDefined()
    expect(error?.message).toContain('Schema file not found')
    expect(error?.message).toContain('schema.json - did you run "sanity schema extract"?')
    expect(error?.oclif?.exit).toBe(1)
  })

  test('should generate types from queries', async () => {
    const cwd = await testExample('dev')
    process.chdir(cwd)

    const {error, stderr} = await testCommand(TypegenGenerateCommand, [])

    expect(error).toBeUndefined()
    expect(stderr).toContain(`- Loading config…`)
    expect(stderr).toContain(`Config loaded from sanity.cli.ts`)
    expect(stderr).toContain(`- Loading schema…`)
    expect(stderr).toContain(`Schema loaded from ./schema.json`)
    expect(stderr).toContain(`- Generating schema types…`)
    expect(stderr).toContain(`- Generating query types…`)
    expect(stderr).toContain(`Successfully generated types`)
    expect(stderr).toContain(`└─ 31 queries and 18 schema types`)
    expect(stderr).toContain(`└─ found queries in 3 files after evaluating 4 files`)
    expect(stderr).toContain(`└─ formatted the generated code with prettier`)
  })

  test('does not format generated types when formatGeneratedCode is false', async () => {
    const cwd = await testExample('dev')
    process.chdir(cwd)

    await writeFile(
      join(cwd, 'sanity.cli.ts'),
      `import {defineCliConfig} from 'sanity/cli'

      export default defineCliConfig({
        typegen: {
          formatGeneratedCode: false,
        }
      })
    `.trim(),
    )

    const {error, stderr} = await testCommand(TypegenGenerateCommand, [])

    expect(error).toBeUndefined()
    expect(stderr).not.toContain('Formatting generated types with prettier…')
    expect(existsSync(join(cwd, 'sanity.types.ts'))).toBe(true)
  })

  test('shows warning when legacy config and cli config are present', async () => {
    const cwd = await testExample('dev')
    process.chdir(cwd)

    await writeFile(
      join(cwd, 'sanity-typegen.json'),
      JSON.stringify({
        typegen: {
          formatGeneratedCode: true,
        },
      }),
    )

    await writeFile(
      join(cwd, 'sanity.cli.ts'),
      `import {defineCliConfig} from 'sanity/cli'

      export default defineCliConfig({
        typegen: {
          formatGeneratedCode: false,
        }
      })
    `.trim(),
    )

    const {error, stderr} = await testCommand(TypegenGenerateCommand, [])

    expect(error).toBeUndefined()
    expect(stderr).toContain(
      `You've specified typegen in your Sanity CLI config, but also have a typegen config.`,
    )
    expect(stderr).toContain(`The config from the Sanity CLI config is used.`)
  })

  test('shows warning when only legacy config is present', async () => {
    const cwd = await testExample('dev')
    process.chdir(cwd)

    await writeFile(
      join(cwd, 'sanity-typegen.json'),
      JSON.stringify({
        typegen: {
          formatGeneratedCode: true,
        },
      }),
    )

    const {error, stderr} = await testCommand(TypegenGenerateCommand, [])

    expect(error).toBeUndefined()
    expect(stderr).toContain(
      `The separate typegen config has been deprecated. Use \`typegen\` in the sanity CLI config instead.`,
    )
    expect(stderr).toContain(
      `See: https://www.sanity.io/docs/help/configuring-typegen-in-sanity-cli-config`,
    )
  })

  test('shows an error when the legacy config file passed as a flag does not exist', async () => {
    const cwd = await testExample('dev')
    process.chdir(cwd)

    const {error} = await testCommand(TypegenGenerateCommand, ['--config-path', 'typegen.json'])

    expect(error).toBeDefined()
    expect(error?.message).toContain('Typegen config file not found: typegen.json')
    expect(error?.oclif?.exit).toBe(1)
  })
})
