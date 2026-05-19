import {existsSync} from 'node:fs'
import {copyFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

import {testCommand, testFixture} from '@sanity/cli-test'
import {describe, expect, test} from 'vitest'

import {TypegenGenerateCommand} from '../generate.js'

const kitchenSinkUrl = new URL(
  '../../../polyglot/__fixtures__/kitchen-sink-schema.json',
  import.meta.url,
)

describe('#typegen:generate (US5 — output-path collision)', () => {
  test('two languages emitting to the same path abort before any I/O', async () => {
    const cwd = await testFixture('dev')
    process.chdir(cwd)

    await copyFile(fileURLToPath(kitchenSinkUrl), join(cwd, 'schema.json'))

    // Each language's `parseConfig` enforces its own extension; we collide TS against
    // Go because the TS generator does not constrain the extension and will accept a
    // `.go`-suffixed output path. This is the cleanest cross-language collision the
    // validation order can detect (step 4 — FR-016).
    const sharedPath = './sanity.gen.go'
    await writeFile(
      join(cwd, 'sanity.cli.ts'),
      `import {defineCliConfig} from 'sanity/cli'

      export default defineCliConfig({
        typegen: {
          typescript: {
            schema: './schema.json',
            generates: '${sharedPath}',
            formatGeneratedCode: false,
          },
          go: {
            schema: './schema.json',
            generates: '${sharedPath}',
            packageName: 'sanitytypes',
            formatGeneratedCode: false,
          },
        }
      })
    `.trim(),
    )

    const {error} = await testCommand(TypegenGenerateCommand, [])

    expect(error).toBeDefined()
    expect(error?.oclif?.exit).toBe(1)
    expect(error?.message).toContain('multiple languages emit to')
    expect(error?.message).toContain(join(cwd, 'sanity.gen.go'))
    expect(error?.message).toContain('typescript')
    expect(error?.message).toContain('go')

    expect(existsSync(join(cwd, 'sanity.gen.go'))).toBe(false)
  })
})
