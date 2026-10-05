import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {type SchemaType} from 'groq-js'
import {afterEach, expect, test} from 'vitest'

// The runner spawns its worker from the built output, so this test runs dist/, which
// `pnpm test` builds first through `pretest`. The URL is computed so that typechecking a
// checkout without dist/ does not fail to resolve it; the type still comes from src/.
const {runTypegenGenerate} = (await import(
  new URL('../../../dist/_exports/index.js', import.meta.url).href
)) as typeof import('../typegenGenerate.js')

const schema: SchemaType = [
  {
    attributes: {
      _id: {type: 'objectAttribute', value: {type: 'string'}},
      _type: {type: 'objectAttribute', value: {type: 'string', value: 'book'}},
      title: {optional: true, type: 'objectAttribute', value: {type: 'string'}},
    },
    name: 'book',
    type: 'document',
  },
]

let dir: string | undefined

afterEach(async () => {
  if (dir) await rm(dir, {force: true, recursive: true})
  dir = undefined
})

test('generates from an extracted schema with no schema file on disk', async () => {
  dir = await mkdtemp(join(tmpdir(), 'codegen-run-'))
  await mkdir(join(dir, 'src'))
  await writeFile(
    join(dir, 'src', 'books.ts'),
    "import {defineQuery} from 'groq'\nexport const booksQuery = defineQuery('*[_type == \"book\"]{title}')\n",
  )

  // No schema.json exists in `dir`, so reading config.schema would fail with ENOENT.
  const result = await runTypegenGenerate({
    config: {
      formatGeneratedCode: false,
      generates: './sanity.types.ts',
      // Absolute, because the query scan globs against process.cwd() rather than workDir.
      path: join(dir, 'src/**/*.ts'),
    },
    extractedSchema: schema,
    resource: {dataset: 'test', projectId: 'abc123'},
    workDir: dir,
  })

  expect(result.queriesCount).toBe(1)
  expect(result.schemaTypesCount).toBe(1)

  const written = await readFile(join(dir, 'sanity.types.ts'), 'utf8')
  expect(written).toContain('"abc123.test": AllSanitySchemaTypes;')
  expect(written).toContain('"*[_type == \\"book\\"]{title}": BooksQueryResult;')
  // An extracted schema has no file to name.
  expect(written).not.toContain('// Source: schema.json')
})

test('carries projections through the worker into the written file', async () => {
  dir = await mkdtemp(join(tmpdir(), 'codegen-run-'))
  await mkdir(join(dir, 'src'))
  await writeFile(
    join(dir, 'src', 'projections.ts'),
    "import {defineProjection} from '@sanity/sdk-react'\nexport const bookTitle = defineProjection('book', '{title}')\n",
  )

  await runTypegenGenerate({
    config: {
      formatGeneratedCode: false,
      generates: './sanity.types.ts',
      path: join(dir, 'src/**/*.ts'),
    },
    extractedSchema: schema,
    resource: {dataset: 'test', projectId: 'abc123'},
    workDir: dir,
  })

  const written = await readFile(join(dir, 'sanity.types.ts'), 'utf8')
  // The optional field stays nullable; only a missing document's null is dropped.
  expect(written).toContain('export type BookTitleResult = {\n  title: string | null;\n};')
  expect(written).toMatch(/"abc123\.test": \{\s*"book": \{\s*"\{title\}": BookTitleResult;/)
})
