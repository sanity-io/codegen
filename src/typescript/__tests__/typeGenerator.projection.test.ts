import {type SchemaType} from 'groq-js'
import {describe, expect, test} from 'vitest'

import {TypeGenerator} from '../typeGenerator.js'
import {type EvaluatedModule, type ExtractedModule, type ExtractedProjection} from '../types.js'

/** `book` and `author` documents that share no fields, plus an object type. */
const schema: SchemaType = [
  {
    attributes: {
      _id: {type: 'objectAttribute', value: {type: 'string'}},
      _type: {type: 'objectAttribute', value: {type: 'string', value: 'book'}},
      title: {type: 'objectAttribute', value: {type: 'string'}},
    },
    name: 'book',
    type: 'document',
  },
  {
    attributes: {
      _id: {type: 'objectAttribute', value: {type: 'string'}},
      _type: {type: 'objectAttribute', value: {type: 'string', value: 'author'}},
      name: {type: 'objectAttribute', value: {type: 'string'}},
    },
    name: 'author',
    type: 'document',
  },
  {
    name: 'seo',
    type: 'type',
    value: {
      attributes: {title: {type: 'objectAttribute', value: {type: 'string'}}},
      type: 'object',
    },
  },
]

function projection(name: string, text: string, documentType?: string): ExtractedProjection {
  return {
    filename: '/src/projections.ts',
    projection: text,
    variable: {id: {name, type: 'Identifier'}},
    ...(documentType === undefined ? {} : {documentType}),
  }
}

async function* modules(...projections: ExtractedProjection[]): AsyncGenerator<ExtractedModule> {
  yield {errors: [], filename: '/src/projections.ts', projections, queries: []}
}

async function generate(
  projections: ExtractedProjection[],
  {resource = true}: {resource?: boolean} = {},
) {
  const evaluatedModules: EvaluatedModule[] = []
  const {code} = await new TypeGenerator().generateTypes({
    overloadClientMethods: false,
    queries: modules(...projections),
    reporter: {
      event: {generatedQueryTypes: () => {}, generatedSchemaTypes: () => {}},
      stream: {
        evaluatedModules: {
          emit: (module: EvaluatedModule) => evaluatedModules.push(module),
          end: () => {},
        },
      },
    } as never,
    root: '/src',
    schema,
    ...(resource ? {resource: {dataset: 'test', projectId: 'abc123'}} : {}),
  })
  const projectionCode = code.slice(code.indexOf('// Source: projections.ts'))
  return {
    code: projectionCode,
    errors: evaluatedModules.flatMap((module) => module.errors.map((error) => error.message)),
  }
}

describe('TypeGenerator with projections', () => {
  test('types a projection for its document type and registers it under the resource key', async () => {
    const {code} = await generate([projection('bookTitle', '{title}', 'book')])

    expect(code).toMatchInlineSnapshot(`
      "// Source: projections.ts
      // Variable: bookTitle
      // Projection on book: {title}
      export type BookTitleResult = {
        title: string;
      };

      // Resource TypeMap: abc123.test
      declare global {
        interface SanitySchemasByResource {
          "abc123.test": AllSanitySchemaTypes;
        }
        interface SanityQueriesByResource {
          "abc123.test": {};
        }
        interface SanityProjectionsByResource {
          "abc123.test": {
            "book": {
              "{title}": BookTitleResult;
            };
          };
        }
      }

      "
    `)
  })

  test('keys the registry by the exact projection text, whitespace included', async () => {
    const {code} = await generate([projection('bookTitle', '{\n  title\n}', 'book')])

    expect(code).toContain('"{\\n  title\\n}": BookTitleResult;')
  })

  test('evaluates a projection without a document type against every document type', async () => {
    const {code} = await generate([projection('anyTitle', '{title}')])

    expect(code).toContain('export type AnyTitleBookResult = {\n  title: string;\n};')
    expect(code).toContain('export type AnyTitleAuthorResult = {\n  title: null;\n};')
    expect(code).toMatch(/"book": \{\s*"\{title\}": AnyTitleBookResult;/)
    expect(code).toMatch(/"author": \{\s*"\{title\}": AnyTitleAuthorResult;/)
    // Object types are not documents, so a projection never applies to them.
    expect(code).not.toContain('"seo"')
  })

  test('shares one alias between document types with the same result', async () => {
    const {code} = await generate([projection('idOnly', '{_id}')])

    expect(code).toContain('// Projection on book, author: {_id}')
    expect(code).toContain('export type IdOnlyResult = {\n  _id: string;\n};')
    expect(code).toMatch(/"book": \{\s*"\{_id\}": IdOnlyResult;/)
    expect(code).toMatch(/"author": \{\s*"\{_id\}": IdOnlyResult;/)
  })

  test('types projection text shared by two variables as the union of their results', async () => {
    const {code} = await generate([
      projection('bookTitle', '{title}', 'book'),
      projection('otherBookTitle', '{title}', 'book'),
    ])

    expect(code).toContain('"{title}": BookTitleResult | OtherBookTitleResult;')
  })

  test('gives projections with the same variable name distinct aliases', async () => {
    const {code} = await generate([
      projection('bookTitle', '{title}', 'book'),
      projection('bookTitle', '{_id}', 'book'),
    ])

    expect(code.match(/export type BookTitleResult\b/g)).toHaveLength(1)
    expect(code).toContain('export type BookTitleResult_2 = {')
    expect(code).toContain('"{_id}": BookTitleResult_2;')
  })

  test('skips a document type the schema lacks when generating for a resource', async () => {
    // Datasets of one app can scan the same files, and the type can belong to another dataset.
    const {code, errors} = await generate([
      projection('bookTitle', '{title}', 'book'),
      projection('movieTitle', '{title}', 'movie'),
    ])

    expect(errors).toEqual([])
    expect(code).not.toContain('MovieTitleResult')
    expect(code).not.toContain('"movie"')
    expect(code).toContain('"{title}": BookTitleResult;')
  })

  test('reports an object type passed as the document type', async () => {
    const {code, errors} = await generate([projection('objectType', '{title}', 'seo')])

    expect(errors).toEqual([
      expect.stringContaining(`'objectType' in /src/projections.ts: "seo" is not a document type`),
    ])
    expect(code).not.toContain('ObjectTypeResult')
  })

  test('reports a document type the schema lacks when not generating for a resource', async () => {
    const {errors} = await generate([projection('movieTitle', '{title}', 'movie')], {
      resource: false,
    })

    expect(errors).toEqual([
      expect.stringContaining(
        `'movieTitle' in /src/projections.ts: "movie" is not a document type`,
      ),
    ])
  })

  test('declares result types without a resource, but registers nothing', async () => {
    const {code} = await generate([projection('bookTitle', '{title}', 'book')], {
      resource: false,
    })

    expect(code).toContain('export type BookTitleResult = {')
    expect(code).not.toContain('SanityProjectionsByResource')
  })
})
