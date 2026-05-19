import {existsSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {testCommand, testFixture} from '@sanity/cli-test'
import once from 'lodash-es/once.js'
import {beforeEach, describe, expect, test, vi} from 'vitest'

import {TypesGeneratedTrace} from '../../../typegen.telemetry.js'
import {formatPath} from '../../../utils/formatPath.js'
import {testLongRunning} from '../../../utils/test/testLongRunning.js'
import {TypegenGenerateCommand} from '../generate.js'

const mockTrace = {
  complete: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
  start: vi.fn(),
}

async function writeTypeScriptOnlyConfig(cwd: string): Promise<void> {
  await writeFile(
    join(cwd, 'sanity.cli.ts'),
    `import {defineCliConfig} from 'sanity/cli'

    export default defineCliConfig({
      typegen: {
        typescript: {
          schema: './schema.json',
          generates: './sanity.types.ts',
        },
      },
    })
  `.trim(),
  )
}

describe('#typegen:generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('should error when typegen.typescript is configured but the schema is missing', async () => {
    const cwd = await testFixture('basic-studio')
    process.chdir(cwd)

    await writeTypeScriptOnlyConfig(cwd)

    const {error, stderr, stdout} = await testCommand(TypegenGenerateCommand, [])

    expect(error).toBeDefined()
    expect(error?.oclif?.exit).toBe(1)
    expect(stderr).toContain(`typescript config: schema file not found`)
    expect(stderr + stdout).toContain(`1 of 1 language(s) failed: typescript`)
  })

  test('should generate types from queries', async () => {
    const cwd = await testFixture('dev')
    process.chdir(cwd)

    await writeTypeScriptOnlyConfig(cwd)

    const {error, stderr} = await testCommand(TypegenGenerateCommand, [])

    expect(error).toBeUndefined()
    expect(stderr).toContain(`Config loaded from sanity.cli.ts`)
    expect(stderr).toContain(`✔ typescript → ${formatPath(join(cwd, 'sanity.types.ts'))}`)

    const generatedTypes = await readFile(join(cwd, 'sanity.types.ts'))
    expect(generatedTypes.toString()).toMatchSnapshot()
  })

  test('should generate types when schema is an absolute path', async () => {
    const cwd = await testFixture('dev')
    process.chdir(cwd)

    const absoluteSchemaPath = join(cwd, 'schema.json')
    await writeFile(
      join(cwd, 'sanity.cli.ts'),
      `import {defineCliConfig} from 'sanity/cli'

      export default defineCliConfig({
        typegen: {
          typescript: {
            schema: ${JSON.stringify(absoluteSchemaPath)},
            generates: './sanity.types.ts',
          },
        }
      })
    `.trim(),
    )

    const {error, stderr} = await testCommand(TypegenGenerateCommand, [])

    expect(error).toBeUndefined()
    expect(stderr).toContain(`✔ typescript → ${formatPath(join(cwd, 'sanity.types.ts'))}`)
  })

  test('does not format generated types when formatGeneratedCode is false', async () => {
    const cwd = await testFixture('dev')
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

  test('formats generated types with oxfmt when formatGeneratedCode is "oxfmt"', async () => {
    const cwd = await testFixture('dev')
    process.chdir(cwd)

    await writeFile(
      join(cwd, 'sanity.cli.ts'),
      `import {defineCliConfig} from 'sanity/cli'

      export default defineCliConfig({
        typegen: {
          formatGeneratedCode: 'oxfmt',
        }
      })
    `.trim(),
    )

    const {error} = await testCommand(TypegenGenerateCommand, [])

    expect(error).toBeUndefined()
    expect(existsSync(join(cwd, 'sanity.types.ts'))).toBe(true)
  })

  test('emits TypesGeneratedTrace telemetry on successful generation', async () => {
    const cwd = await testFixture('dev')
    process.chdir(cwd)

    await writeTypeScriptOnlyConfig(cwd)

    const mockTelemetry = vi.fn(() => mockTrace)

    const {error} = await testCommand(TypegenGenerateCommand, [], {
      mocks: {
        trace: mockTelemetry,
      },
    })

    expect(error).toBeUndefined()
    expect(mockTelemetry).toHaveBeenCalledWith(TypesGeneratedTrace)
    expect(mockTrace.start).toHaveBeenCalled()
    expect(mockTrace.log).toHaveBeenCalledWith(
      expect.objectContaining({
        configMethod: 'cli',
        languages: expect.objectContaining({
          typescript: expect.objectContaining({
            configOverloadClientMethods: expect.any(Boolean),
            documents: expect.any(Number),
            durationMs: expect.any(Number),
            objects: expect.any(Number),
            queriesCount: expect.any(Number),
            schemaTypesCount: expect.any(Number),
            status: 'success',
            typeNodesGenerated: expect.any(Number),
            unknownTypeNodesGenerated: expect.any(Number),
          }),
        }),
      }),
    )
    expect(mockTrace.complete).toHaveBeenCalled()
    expect(mockTrace.error).not.toHaveBeenCalled()
  })

  test('emits TypesGeneratedTrace error when pre-emission validation throws', async () => {
    const cwd = await testFixture('dev')
    process.chdir(cwd)

    await writeFile(
      join(cwd, 'sanity.cli.ts'),
      `import {defineCliConfig} from 'sanity/cli'

      export default defineCliConfig({
        typegen: {
          typescript: {
            schema: './schema.json',
            generates: './out.ts',
          },
          go: {
            schema: './schema.json',
            generates: './out.ts',
          },
        }
      })
    `.trim(),
    )

    const mockTelemetry = vi.fn(() => mockTrace)

    const {error} = await testCommand(TypegenGenerateCommand, [], {
      mocks: {
        trace: mockTelemetry,
      },
    })

    expect(error).toBeDefined()
    expect(mockTelemetry).toHaveBeenCalledWith(TypesGeneratedTrace)
    expect(mockTrace.error).toHaveBeenCalledWith(expect.any(Error))
    expect(mockTrace.complete).not.toHaveBeenCalled()
  })

  test('shows warning when legacy config and cli config are present', async () => {
    const cwd = await testFixture('dev')
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
    const cwd = await testFixture('dev')
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
    const cwd = await testFixture('dev')
    process.chdir(cwd)

    const {error} = await testCommand(TypegenGenerateCommand, ['--config-path', 'typegen.json'])

    expect(error).toBeDefined()
    expect(error?.message).toContain('Typegen config file not found: typegen.json')
    expect(error?.oclif?.exit).toBe(1)
  })

  describe('watch mode', () => {
    test('generates on startup', async () => {
      const cwd = await testFixture('dev')
      process.chdir(cwd)
      await writeTypeScriptOnlyConfig(cwd)

      await testLongRunning(['typegen', 'generate', '--watch'], {
        async expect({stderr}) {
          expect(stderr).toContain(`✔ typescript → ${formatPath(join(cwd, 'sanity.types.ts'))}`)
        },
      })
    })

    test('generates when a file is created', async () => {
      const cwd = await testFixture('dev')
      process.chdir(cwd)
      await writeTypeScriptOnlyConfig(cwd)

      const randomFilename = `${Math.random().toFixed(18)}file.ts`
      const createAFile = once(() => {
        writeFile(join(cwd, 'src', randomFilename), '')
      })

      await testLongRunning(['typegen', 'generate', '--watch'], {
        async expect({stderr, stdout}) {
          expect(stderr).toContain(`✔ typescript → ${formatPath(join(cwd, 'sanity.types.ts'))}`)

          createAFile()

          expect(stdout).toMatch(`add: ${join('src', randomFilename)}`)
        },
      })
    })
  }, 30_000)
})
