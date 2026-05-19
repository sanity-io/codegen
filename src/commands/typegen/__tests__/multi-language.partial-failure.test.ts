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

describe('#typegen:generate (US5 — partial failure)', () => {
  test('one bad schema path isolates the failure; the other three still emit', async () => {
    const cwd = await testFixture('dev')
    process.chdir(cwd)

    await copyFile(fileURLToPath(kitchenSinkUrl), join(cwd, 'schema.json'))

    await writeFile(
      join(cwd, 'sanity.cli.ts'),
      `import {defineCliConfig} from 'sanity/cli'

      export default defineCliConfig({
        typegen: {
          typescript: {
            schema: './schema.json',
            generates: './sanity.types.ts',
            formatGeneratedCode: false,
          },
          go: {
            schema: './schema.json',
            generates: './sanity.gen.go',
            packageName: 'sanitytypes',
            formatGeneratedCode: false,
          },
          php: {
            schema: './does-not-exist.json',
            generates: './Sanity.php',
            namespace: 'Sanity\\\\Generated',
            formatGeneratedCode: false,
          },
          swift: {
            schema: './schema.json',
            generates: './Sanity.swift',
            formatGeneratedCode: false,
          },
        }
      })
    `.trim(),
    )

    const {error, stderr, stdout} = await testCommand(TypegenGenerateCommand, [])

    expect(error).toBeDefined()
    expect(error?.oclif?.exit).toBe(1)

    const haystack = `${stderr}\n${stdout}`
    expect(haystack).toContain('php config: schema file not found')
    expect(haystack).toContain('1 of 4 language(s) failed: php')

    expect(existsSync(join(cwd, 'sanity.types.ts'))).toBe(true)
    expect(existsSync(join(cwd, 'sanity.gen.go'))).toBe(true)
    expect(existsSync(join(cwd, 'Sanity.swift'))).toBe(true)
    expect(existsSync(join(cwd, 'Sanity.php'))).toBe(false)
  })
})
