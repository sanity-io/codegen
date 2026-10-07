import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {type SchemaType} from 'groq-js'
import {
  createProgram,
  flattenDiagnosticMessageText,
  getPreEmitDiagnostics,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
} from 'typescript'
import {afterEach, describe, expect, test} from 'vitest'

import {TypeGenerator} from '../typeGenerator.js'
import {type ExtractedModule} from '../types.js'

const BOOKS_QUERY = '*[_type == "book"]{title}'
const CLIENT_AUGMENTATION = 'declare module "@sanity/client"'

/** One `book` document type whose `title` field has the given primitive type. */
function bookSchema(titleType: 'number' | 'string'): SchemaType {
  return [
    {
      attributes: {
        _id: {type: 'objectAttribute', value: {type: 'string'}},
        _type: {type: 'objectAttribute', value: {type: 'string', value: 'book'}},
        title: {optional: true, type: 'objectAttribute', value: {type: titleType}},
      },
      name: 'book',
      type: 'document',
    },
  ]
}

async function* booksQuery(): AsyncGenerator<ExtractedModule> {
  yield {
    errors: [],
    filename: '/src/books.ts',
    queries: [
      {
        filename: '/src/books.ts',
        query: BOOKS_QUERY,
        variable: {id: {name: 'booksQuery', type: 'Identifier'}},
      },
    ],
  }
}

/** Two variables holding the same query text, in two files. */
async function* sharedQueryText(): AsyncGenerator<ExtractedModule> {
  for (const [filename, name] of [
    ['/src/a.ts', 'booksQuery'],
    ['/src/b.ts', 'otherBooksQuery'],
  ] as const) {
    yield {
      errors: [],
      filename,
      queries: [{filename, query: BOOKS_QUERY, variable: {id: {name, type: 'Identifier'}}}],
    }
  }
}

async function* noQueries(): AsyncGenerator<ExtractedModule> {
  // intentionally empty
}

function generateForResource(projectId: string, dataset: string, titleType: 'number' | 'string') {
  return new TypeGenerator().generateTypes({
    // An app generating more than one resource turns the flat map off, or the files conflict.
    overloadClientMethods: false,
    queries: booksQuery(),
    resource: {dataset, projectId},
    root: '/src',
    schema: bookSchema(titleType),
  })
}

function generateWithFlatMapSetting(overloadClientMethods: boolean) {
  return new TypeGenerator().generateTypes({
    overloadClientMethods,
    queries: booksQuery(),
    resource: {dataset: 'test', projectId: 'abc123'},
    root: '/src',
    schema: bookSchema('string'),
  })
}

describe('TypeGenerator with a resource', () => {
  test('registers schema and query types under the resource key', async () => {
    const {code} = await new TypeGenerator().generateTypes({
      overloadClientMethods: false,
      queries: booksQuery(),
      resource: {dataset: 'test', projectId: 'abc123'},
      root: '/src',
      schema: bookSchema('string'),
    })

    expect(code).toMatchInlineSnapshot(`
      "export declare const internalGroqTypeReferenceTo: unique symbol;

      export type Book = {
        _id: string;
        _type: "book";
        title?: string;
      };

      export type AllSanitySchemaTypes = Book;

      // Source: books.ts
      // Variable: booksQuery
      // Query: *[_type == "book"]{title}
      export type BooksQueryResult = Array<{
        title: string | null;
      }>;

      // Resource TypeMap: abc123.test
      declare global {
        interface SanitySchemasByResource {
          "abc123.test": AllSanitySchemaTypes;
        }
        interface SanityQueriesByResource {
          "abc123.test": {
            "*[_type == \\"book\\"]{title}": BooksQueryResult;
          };
        }
        interface SanityProjectionsByResource {
          "abc123.test": {};
        }
      }

      "
    `)
  })

  test('never augments @sanity/client', async () => {
    // An augmentation fails with TS2664 wherever the client is not resolvable from the
    // generated file, which is the App SDK's default layout under pnpm.
    const {code} = await new TypeGenerator().generateTypes({
      overloadClientMethods: false,
      queries: booksQuery(),
      resource: {dataset: 'test', projectId: 'abc123'},
      root: '/src',
      schema: bookSchema('string'),
    })

    expect(code).not.toContain(CLIENT_AUGMENTATION)
  })

  test('writes the flat map alongside only when overloadClientMethods is on', async () => {
    const on = (await generateWithFlatMapSetting(true)).code
    expect(on).toMatch(/interface SanityQueries \{/)
    expect(on).toContain('interface SanityQueriesByResource')

    const off = (await generateWithFlatMapSetting(false)).code
    expect(off).not.toMatch(/interface SanityQueries \{/)
    expect(off).toContain('interface SanityQueriesByResource')
  })

  test('registers the schema and an empty query entry when there are no queries', async () => {
    const {code} = await new TypeGenerator().generateTypes({
      queries: noQueries(),
      resource: {dataset: 'test', projectId: 'abc123'},
      root: '/src',
      schema: bookSchema('string'),
    })

    expect(code).toContain('"abc123.test": AllSanitySchemaTypes;')
    expect(code).toMatch(/interface SanityQueriesByResource \{\s*"abc123\.test": \{\};\s*\}/)
  })

  test('types query text shared by two variables as the union of their results', async () => {
    const {code} = await new TypeGenerator().generateTypes({
      overloadClientMethods: false,
      queries: sharedQueryText(),
      resource: {dataset: 'test', projectId: 'abc123'},
      root: '/src',
      schema: bookSchema('string'),
    })

    expect(code).toContain(
      '"*[_type == \\"book\\"]{title}": BooksQueryResult | OtherBooksQueryResult;',
    )
  })

  test('rejects a resource missing its project or dataset', async () => {
    await expect(
      new TypeGenerator().generateTypes({
        queries: noQueries(),
        resource: {dataset: '', projectId: 'abc123'},
        schema: bookSchema('string'),
      }),
    ).rejects.toThrow('needs both a projectId and a dataset')
  })

  test('leaves output without a resource unchanged', async () => {
    const {code} = await new TypeGenerator().generateTypes({
      queries: booksQuery(),
      root: '/src',
      schema: bookSchema('string'),
    })

    expect(code).toContain('interface SanityQueries {')
    expect(code).not.toContain('ByResource')
  })
})

describe('files generated for two resources', () => {
  let dir: string | undefined

  afterEach(async () => {
    if (dir) await rm(dir, {force: true, recursive: true})
    dir = undefined
  })

  test('compile in a pnpm layout and resolve the same query text per resource', async () => {
    const testTypes = await generateForResource('abc123', 'test', 'string')
    const productionTypes = await generateForResource('abc123', 'production', 'number')

    // The layout pnpm gives an App SDK app: @sanity/client is a dependency of the SDK only, so
    // it is not resolvable from the app root where the generated files live. A generated file
    // that augmented @sanity/client would fail here with TS2664.
    dir = await mkdtemp(join(tmpdir(), 'codegen-resource-'))
    const sdk = join(dir, 'node_modules', 'fake-sdk')
    const client = join(sdk, 'node_modules', '@sanity', 'client')
    await mkdir(client, {recursive: true})

    // A stub of the declarations @sanity/client 8.7.0 publishes for these registries.
    await writeFile(
      join(client, 'package.json'),
      JSON.stringify({name: '@sanity/client', types: 'index.d.ts'}),
    )
    await writeFile(
      join(client, 'index.d.ts'),
      [
        'declare global {',
        '  interface SanitySchemasByResource {}',
        '  interface SanityQueriesByResource {}',
        '}',
        'export interface SanitySchemasByResource extends globalThis.SanitySchemasByResource {}',
        'export interface SanityQueriesByResource extends globalThis.SanityQueriesByResource {}',
      ].join('\n'),
    )

    // Stands in for the App SDK: it reads the registries through its own copy of the client.
    await writeFile(
      join(sdk, 'package.json'),
      JSON.stringify({name: 'fake-sdk', types: 'index.d.ts'}),
    )
    await writeFile(
      join(sdk, 'index.d.ts'),
      [
        "import type {SanityQueriesByResource, SanitySchemasByResource} from '@sanity/client'",
        'export type ResolveQuery<R extends string, Q extends string> =',
        '  R extends keyof SanityQueriesByResource',
        '    ? Q extends keyof SanityQueriesByResource[R] ? SanityQueriesByResource[R][Q] : never',
        '    : never',
        'export type ResolveSchema<R extends string> =',
        '  R extends keyof SanitySchemasByResource ? SanitySchemasByResource[R] : never',
      ].join('\n'),
    )

    await writeFile(join(dir, 'sanity.types.test.ts'), testTypes.code)
    await writeFile(join(dir, 'sanity.types.production.ts'), productionTypes.code)
    await writeFile(
      join(dir, 'consumer.ts'),
      [
        "import type {ResolveQuery, ResolveSchema} from 'fake-sdk'",
        'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false',
        'type Expect<T extends true> = T',
        'export type Checks = [',
        `  Expect<Equal<ResolveQuery<'abc123.test', '${BOOKS_QUERY}'>, Array<{title: string | null}>>>,`,
        `  Expect<Equal<ResolveQuery<'abc123.production', '${BOOKS_QUERY}'>, Array<{title: number | null}>>>,`,
        "  Expect<Equal<ResolveSchema<'abc123.test'>['_type'], 'book'>>,",
        ']',
      ].join('\n'),
    )

    const program = createProgram(
      ['sanity.types.test.ts', 'sanity.types.production.ts', 'consumer.ts'].map((file) =>
        join(dir!, file),
      ),
      {
        module: ModuleKind.ESNext,
        moduleResolution: ModuleResolutionKind.Bundler,
        noEmit: true,
        strict: true,
        target: ScriptTarget.ES2022,
        types: [],
      },
    )
    const diagnostics = getPreEmitDiagnostics(program).map((d) =>
      flattenDiagnosticMessageText(d.messageText, '\n'),
    )

    expect(diagnostics).toEqual([])
  })
})
