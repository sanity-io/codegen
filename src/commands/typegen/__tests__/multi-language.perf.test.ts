import {copyFile, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

import {describe, expect, test} from 'vitest'

import {runTypegenGenerate} from '../../../actions/typegenGenerate.js'

const kitchenSinkUrl = new URL(
  '../../../polyglot/__fixtures__/kitchen-sink-schema.json',
  import.meta.url,
)

const SLOW_CI = process.env.POLYGLOT_TYPEGEN_SLOW_CI === '1'

describe.skipIf(SLOW_CI)('#typegen:generate (US5 — perf budget SC-005)', () => {
  test('all four generators finish under 10s against kitchen-sink', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'polyglot-perf-'))
    try {
      const schemaPath = join(workDir, 'schema.json')
      await copyFile(fileURLToPath(kitchenSinkUrl), schemaPath)

      const config = {
        go: {
          formatGeneratedCode: false,
          generates: join(workDir, 'sanity.gen.go'),
          packageName: 'sanitytypes',
          schema: schemaPath,
        },
        php: {
          formatGeneratedCode: false,
          generates: join(workDir, 'Sanity.php'),
          namespace: 'Sanity\\Generated',
          schema: schemaPath,
        },
        swift: {
          formatGeneratedCode: false,
          generates: join(workDir, 'Sanity.swift'),
          schema: schemaPath,
        },
        typescript: {
          formatGeneratedCode: false,
          generates: join(workDir, 'sanity.types.ts'),
          schema: schemaPath,
        },
      }

      const start = Date.now()
      const result = await runTypegenGenerate({config, workDir})
      const elapsed = Date.now() - start

      expect(result.languages.typescript?.status).toBe('success')
      expect(result.languages.go?.status).toBe('success')
      expect(result.languages.php?.status).toBe('success')
      expect(result.languages.swift?.status).toBe('success')
      expect(elapsed).toBeLessThan(10_000)
    } finally {
      await rm(workDir, {force: true, recursive: true})
    }
  }, 15_000)
})
