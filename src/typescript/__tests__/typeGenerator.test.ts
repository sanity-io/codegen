import * as t from '@babel/types'
import {WorkerChannelReceiver, WorkerChannelReporter} from '@sanity/worker-channels'
import {type SchemaType} from 'groq-js'
import {describe, expect, test} from 'vitest'

import {TypeGenerator, type TypegenWorkerChannel} from '../typeGenerator.js'
import {EvaluatedModule, type ExtractedModule, QueryExtractionError} from '../types.js'

// TODO: replace with Array.fromAsync once we drop support for node v20
// node v22 is the first version to support Array.fromAsync
async function ArrayFromAsync<T>(asyncIterable: AsyncIterable<T>) {
  const values: T[] = []
  for await (const item of asyncIterable) {
    values.push(item)
  }
  return values
}

async function* empty() {
  // intentionally empty
}

describe(TypeGenerator.name, () => {
  test('generates types and reports progress via a worker channel reporter', async () => {
    const emitter = new EventTarget()
    const receiver = WorkerChannelReceiver.from<TypegenWorkerChannel>(emitter)
    const typeGenerator = new TypeGenerator()

    const schema: SchemaType = [
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'foo'}},
          foo: {optional: true, type: 'objectAttribute', value: {type: 'string'}},
        },
        name: 'foo',
        type: 'document',
      },
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'bar'}},
          bar: {optional: true, type: 'objectAttribute', value: {type: 'string'}},
        },
        name: 'bar',
        type: 'document',
      },
    ]

    async function* getQueries(): AsyncGenerator<ExtractedModule> {
      yield {
        errors: [],
        filename: '/src/foo.ts',
        queries: [
          {
            filename: '/src/foo.ts',
            query: '*[_type == "foo"]',
            variable: {id: {name: 'queryFoo', type: 'Identifier'}},
          },
        ],
      }
      yield {errors: [], filename: '/src/no-queries', queries: []}
      yield {
        errors: [
          new QueryExtractionError({
            cause: new Error('Test Error'),
            filename: '/src/has-an-error',
            variable: {id: {name: 'hadAnError', type: 'Identifier'}},
          }),
        ],
        filename: '/src/has-an-error',
        queries: [],
      }
      yield {
        errors: [],
        filename: '/src/bar.ts',
        queries: [
          {
            filename: '/src/bar.ts',
            query: '*[_type == "bar"]',
            variable: {id: {name: 'queryBar', type: 'Identifier'}},
          },
        ],
      }
    }

    const complete = typeGenerator.generateTypes({
      queries: getQueries(),
      reporter: WorkerChannelReporter.from<TypegenWorkerChannel>(emitter),
      root: '/src',
      schema,
      schemaPath: '/src/changed-path/my-schema-path.json',
    })

    const {allSanitySchemaTypesDeclaration, internalReferenceSymbol, schemaTypeDeclarations} =
      await receiver.event.generatedSchemaTypes()

    expect(allSanitySchemaTypesDeclaration.code).toMatchInlineSnapshot(`
      "export type AllSanitySchemaTypes = Foo | Bar;

      "
    `)
    expect(internalReferenceSymbol.code).toMatchInlineSnapshot(`
      "export declare const internalGroqTypeReferenceTo: unique symbol;

      "
    `)
    expect(schemaTypeDeclarations.length).toBe(2)
    const [fooDeclaration, barDeclaration] = schemaTypeDeclarations

    expect(fooDeclaration).toMatchObject({
      code: expect.stringContaining('export type Foo'),
      id: {name: 'Foo'},
      name: 'foo',
    })
    expect(barDeclaration).toMatchObject({
      code: expect.stringContaining('export type Bar'),
      id: {name: 'Bar'},
      name: 'bar',
    })

    const evaluatedModules = await ArrayFromAsync(receiver.stream.evaluatedModules())
    expect(evaluatedModules.length).toBe(4)

    const [foo, noQueries, hasAnError, bar] = evaluatedModules

    // Assert foo module
    expect(foo?.filename).toBe('/src/foo.ts')
    expect(foo?.queries).toHaveLength(1)
    expect(foo?.errors).toHaveLength(0)
    expect(foo?.queries[0]?.variable.id.name).toBe('queryFoo')
    expect(foo?.queries[0]?.query).toBe('*[_type == "foo"]')

    // Assert noQueries module
    expect(noQueries?.filename).toBe('/src/no-queries')
    expect(noQueries?.queries).toHaveLength(0)
    expect(noQueries?.errors).toHaveLength(0)

    // Assert hasAnError module
    expect(hasAnError?.filename).toBe('/src/has-an-error')
    expect(hasAnError?.queries).toHaveLength(0)
    expect(hasAnError?.errors).toHaveLength(1)
    expect(hasAnError?.errors[0]).toBeInstanceOf(QueryExtractionError)

    // Assert bar module
    expect(bar?.filename).toBe('/src/bar.ts')
    expect(bar?.queries).toHaveLength(1)
    expect(bar?.errors).toHaveLength(0)
    expect(bar?.queries[0]?.variable.id.name).toBe('queryBar')
    expect(bar?.queries[0]?.query).toBe('*[_type == "bar"]')

    const {queryMapDeclaration} = await receiver.event.generatedQueryTypes()

    expect(queryMapDeclaration.code).toMatchInlineSnapshot(String.raw`
      "// Query TypeMap
      import "@sanity/client";
      declare module "@sanity/client" {
        interface SanityQueries {
          "*[_type == \"foo\"]": QueryFooResult;
          "*[_type == \"bar\"]": QueryBarResult;
        }
      }

      "
    `)

    const {code} = await complete
    expect(code).toMatchInlineSnapshot(String.raw`
      "// Source: changed-path/my-schema-path.json
      export type Foo = {
        _id: string;
        _type: "foo";
        foo?: string;
      };

      export type Bar = {
        _id: string;
        _type: "bar";
        bar?: string;
      };

      export type AllSanitySchemaTypes = Foo | Bar;

      export declare const internalGroqTypeReferenceTo: unique symbol;

      type ArrayOf<T> = Array<T & {
        _key: string;
      }>;

      // Source: foo.ts
      // Variable: queryFoo
      // Query: *[_type == "foo"]
      export type QueryFooResult = Array<{
        _id: string;
        _type: "foo";
        foo?: string;
      }>;

      // Source: bar.ts
      // Variable: queryBar
      // Query: *[_type == "bar"]
      export type QueryBarResult = Array<{
        _id: string;
        _type: "bar";
        bar?: string;
      }>;

      // Query TypeMap
      import "@sanity/client";
      declare module "@sanity/client" {
        interface SanityQueries {
          "*[_type == \"foo\"]": QueryFooResult;
          "*[_type == \"bar\"]": QueryBarResult;
        }
      }

      "
    `)
  })

  test('does not generate the query type map if `overloadClientMethods` is false', async () => {
    const typeGenerator = new TypeGenerator()

    const schema: SchemaType = [
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'foo'}},
          foo: {optional: true, type: 'objectAttribute', value: {type: 'string'}},
        },
        name: 'foo',
        type: 'document',
      },
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'bar'}},
          bar: {optional: true, type: 'objectAttribute', value: {type: 'string'}},
        },
        name: 'bar',
        type: 'document',
      },
    ]

    // eslint-disable-next-line unicorn/consistent-function-scoping
    async function* getQueries(): AsyncGenerator<ExtractedModule> {
      yield {
        errors: [],
        filename: '/src/foo.ts',
        queries: [
          {
            filename: '/src/foo.ts',
            query: '*[_type == "foo"]',
            variable: {id: {name: 'queryFoo', type: 'Identifier'}},
          },
        ],
      }
      yield {
        errors: [],
        filename: '/src/bar.ts',
        queries: [
          {
            filename: '/src/bar.ts',
            query: '*[_type == "bar"]',
            variable: {id: {name: 'queryBar', type: 'Identifier'}},
          },
        ],
      }
    }

    const {code} = await typeGenerator.generateTypes({
      overloadClientMethods: false,
      queries: getQueries(),
      root: '/src',
      schema,
    })

    expect(code).toMatchInlineSnapshot(`
      "export type Foo = {
        _id: string;
        _type: "foo";
        foo?: string;
      };

      export type Bar = {
        _id: string;
        _type: "bar";
        bar?: string;
      };

      export type AllSanitySchemaTypes = Foo | Bar;

      export declare const internalGroqTypeReferenceTo: unique symbol;

      type ArrayOf<T> = Array<T & {
        _key: string;
      }>;

      // Source: foo.ts
      // Variable: queryFoo
      // Query: *[_type == "foo"]
      export type QueryFooResult = Array<{
        _id: string;
        _type: "foo";
        foo?: string;
      }>;

      // Source: bar.ts
      // Variable: queryBar
      // Query: *[_type == "bar"]
      export type QueryBarResult = Array<{
        _id: string;
        _type: "bar";
        bar?: string;
      }>;

      "
    `)
  })

  test('does not generate the query type map if no extracted queries are provided', async () => {
    const typeGenerator = new TypeGenerator()

    const schema: SchemaType = [
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'foo'}},
          foo: {optional: true, type: 'objectAttribute', value: {type: 'string'}},
        },
        name: 'foo',
        type: 'document',
      },
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'bar'}},
          bar: {optional: true, type: 'objectAttribute', value: {type: 'string'}},
        },
        name: 'bar',
        type: 'document',
      },
    ]

    const {code} = await typeGenerator.generateTypes({
      root: '/src',
      schema,
    })

    expect(code).toMatchInlineSnapshot(`
      "export type Foo = {
        _id: string;
        _type: "foo";
        foo?: string;
      };

      export type Bar = {
        _id: string;
        _type: "bar";
        bar?: string;
      };

      export type AllSanitySchemaTypes = Foo | Bar;

      export declare const internalGroqTypeReferenceTo: unique symbol;

      type ArrayOf<T> = Array<T & {
        _key: string;
      }>;

      "
    `)
  })

  test('memoizes getInternalReferenceSymbolDeclaration', async () => {
    const typeGenerator = new TypeGenerator()

    // Get the internal reference symbol multiple times
    const symbol1 = typeGenerator['getInternalReferenceSymbolDeclaration']()
    const symbol2 = typeGenerator['getInternalReferenceSymbolDeclaration']()
    const symbol3 = typeGenerator['getInternalReferenceSymbolDeclaration']()

    // Should return the exact same object instance (reference equality)
    expect(symbol1).toBe(symbol2)
    expect(symbol2).toBe(symbol3)
    expect(symbol1.id).toBe(symbol2.id)
    expect(symbol1.code).toBe(symbol2.code)
    expect(symbol1.ast).toBe(symbol2.ast)
  })

  test('recomputes memoized values when input parameters change', async () => {
    const typeGenerator = new TypeGenerator()

    const schema1: SchemaType = [
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'doc1'}},
        },
        name: 'doc1',
        type: 'document',
      },
    ]

    const schema2: SchemaType = [
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'doc2'}},
        },
        name: 'doc2',
        type: 'document',
      },
    ]

    const options1 = {
      queries: empty(),
      root: '/test-root',
      schema: schema1,
    }

    const options2 = {
      queries: empty(),
      root: '/test-root',
      schema: schema2,
    }

    const emitter1 = new EventTarget()
    const emitter2 = new EventTarget()
    const receiver1 = WorkerChannelReceiver.from<TypegenWorkerChannel>(emitter1)
    const receiver2 = WorkerChannelReceiver.from<TypegenWorkerChannel>(emitter2)
    const reporter1 = WorkerChannelReporter.from<TypegenWorkerChannel>(emitter1)
    const reporter2 = WorkerChannelReporter.from<TypegenWorkerChannel>(emitter2)

    await typeGenerator.generateTypes({...options1, reporter: reporter1})
    await typeGenerator.generateTypes({...options2, reporter: reporter2})

    // Get declarations with different schemas
    const {schemaTypeDeclarations: schemaTypeDeclarations1} =
      await receiver1.event.generatedSchemaTypes()
    const {schemaTypeDeclarations: schemaTypeDeclarations2} =
      await receiver2.event.generatedSchemaTypes()

    // Should return different instances when schema changes
    expect(schemaTypeDeclarations1).not.toBe(schemaTypeDeclarations2)
    expect(schemaTypeDeclarations1[0]?.name).toBe('doc1')
    expect(schemaTypeDeclarations2[0]?.name).toBe('doc2')
  })

  test('memoization works correctly with multiple generateTypes calls', async () => {
    const typeGenerator = new TypeGenerator()

    const schema: SchemaType = [
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'testDoc'}},
        },
        name: 'testDoc',
        type: 'document',
      },
    ]

    const stableQuery: ExtractedModule = {
      errors: [],
      filename: '/src/test.ts',
      queries: [
        {
          filename: '/src/test.ts',
          query: '*[_type == "testDoc"]',
          variable: {id: t.identifier('testQuery')},
        },
      ],
    }

    async function* getQueries() {
      yield stableQuery
    }

    const options = {
      root: '/test-root',
      schema,
    }

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const createReporterReceiver = () => {
      const emitter = new EventTarget()
      const receiver = WorkerChannelReceiver.from<TypegenWorkerChannel>(emitter)
      const reporter = WorkerChannelReporter.from<TypegenWorkerChannel>(emitter)
      return {receiver, reporter}
    }

    const [e1, e2, e3] = Array.from({length: 4}).map(() => createReporterReceiver())

    const r1 = await typeGenerator.generateTypes({
      ...options,
      queries: getQueries(),
      reporter: e1?.reporter,
    })
    const r2 = await typeGenerator.generateTypes({
      ...options,
      queries: getQueries(),
      reporter: e2?.reporter,
    })
    const r3 = await typeGenerator.generateTypes({
      ...options,
      queries: getQueries(),
      reporter: e3?.reporter,
      // shallow copy the schema
      schema: [...schema],
    })

    // should be identical because the content did not change and these are strings
    expect(r1.code).toBe(r2.code)
    expect(r2.code).toBe(r3.code)

    // these will always be different because the AST is generated on each call
    expect(r1.ast).not.toBe(r2.ast)
    expect(r2.ast).not.toBe(r3.ast)

    const s1 = await e1?.receiver.event.generatedSchemaTypes()
    const s2 = await e2?.receiver.event.generatedSchemaTypes()
    const s3 = await e3?.receiver.event.generatedSchemaTypes()

    // the first two should be the same because the content did not change
    expect(s1?.schemaTypeDeclarations).toBe(s2?.schemaTypeDeclarations)
    // the last one should be different because the schema changed
    expect(s2?.schemaTypeDeclarations).not.toBe(s3?.schemaTypeDeclarations)

    const m1 = await ArrayFromAsync(
      e1?.receiver.stream.evaluatedModules() as AsyncIterable<EvaluatedModule>,
    )
    const m2 = await ArrayFromAsync(
      e2?.receiver.stream.evaluatedModules() as AsyncIterable<EvaluatedModule>,
    )
    const m3 = await ArrayFromAsync(
      e3?.receiver.stream.evaluatedModules() as AsyncIterable<EvaluatedModule>,
    )

    // none of these will be the same because the array itself is generated on each call
    expect(m1).not.toBe(m2)
    expect(m2).not.toBe(m3)

    // however, since all of them have been yielded the same query, the
    // resulting TS type should be the same for all of them
    const t1 = m1.flatMap((m) => m.queries).map((r) => r.tsType)[0]
    const t2 = m2.flatMap((m) => m.queries).map((r) => r.tsType)[0]
    const t3 = m3.flatMap((m) => m.queries).map((r) => r.tsType)[0]

    expect(t1).toBe(t2)
    // the schema is different which means the schema type generator interface
    // won't be the same
    expect(t2).not.toBe(t3)

    const q1 = await e1?.receiver.event.generatedQueryTypes()
    const q2 = await e2?.receiver.event.generatedQueryTypes()
    const q3 = await e3?.receiver.event.generatedQueryTypes()

    expect(q1?.queryMapDeclaration).not.toBe(q2?.queryMapDeclaration)
    expect(q2?.queryMapDeclaration).not.toBe(q3?.queryMapDeclaration)
  })

  test('should use ArrayMember generic for objects in arrays', async () => {
    const schema: SchemaType = [
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'post'}},
          // Arrays with both inline objects and other types should result in a union between Array and ArrayOf
          mixed: {
            type: 'objectAttribute',
            value: {
              of: {
                of: [
                  // These should be a union wrapped in an Array
                  {type: 'number'},
                  {type: 'string'},
                  {type: 'null'},

                  // While this one should be in an ArrayOf
                  {name: 'tag', type: 'inline'},
                ],
                type: 'union',
              },
              type: 'array',
            },
          },
          // Inline object array
          sections: {
            optional: true,
            type: 'objectAttribute',
            value: {
              of: {
                attributes: {
                  _key: {
                    type: 'objectAttribute',
                    value: {type: 'string'},
                  },
                  _type: {
                    type: 'objectAttribute',
                    value: {type: 'string', value: 'section'},
                  },
                  title: {
                    optional: true,
                    type: 'objectAttribute',
                    value: {type: 'string'},
                  },
                },
                type: 'object',
              },
              type: 'array',
            },
          },
          // Arrays of strings
          strings: {
            type: 'objectAttribute',
            value: {
              of: {
                type: 'string',
              },
              type: 'array',
            },
          },
          // Array of reusable types
          tags: {
            optional: true,
            type: 'objectAttribute',
            value: {
              of: {
                of: [
                  {
                    name: 'tag',
                    type: 'inline',
                  },
                  {
                    name: 'rag',
                    type: 'inline',
                  },
                ],
                type: 'union',
              },
              type: 'array',
            },
          },
        },
        name: 'post',
        type: 'document',
      },
      {
        name: 'tag',
        type: 'type',
        value: {
          attributes: {
            _key: {
              type: 'objectAttribute',
              value: {type: 'string'},
            },
            _type: {
              type: 'objectAttribute',
              value: {type: 'string', value: 'tag'},
            },
            label: {
              optional: true,
              type: 'objectAttribute',
              value: {type: 'string'},
            },
          },
          type: 'object',
        },
      },
      {
        name: 'rag',
        type: 'type',
        value: {
          attributes: {
            _key: {
              type: 'objectAttribute',
              value: {type: 'string'},
            },
            _type: {
              type: 'objectAttribute',
              value: {type: 'string', value: 'rag'},
            },
            color: {
              optional: true,
              type: 'objectAttribute',
              value: {type: 'string'},
            },
          },
          type: 'object',
        },
      },
    ]

    const typeGenerator = new TypeGenerator()
    const result = await typeGenerator.generateTypes({schema})

    expect(result.code).toMatchInlineSnapshot(`
      "export type Post = {
        _id: string;
        _type: "post";
        mixed: Array<number | string | null> | ArrayOf<Tag>;
        sections?: Array<{
          _key: string;
          _type: "section";
          title?: string;
        }>;
        strings: Array<string>;
        tags?: ArrayOf<Tag | Rag>;
      };

      export type Tag = {
        _key: string;
        _type: "tag";
        label?: string;
      };

      export type Rag = {
        _key: string;
        _type: "rag";
        color?: string;
      };

      export type AllSanitySchemaTypes = Post | Tag | Rag;

      export declare const internalGroqTypeReferenceTo: unique symbol;

      type ArrayOf<T> = Array<T & {
        _key: string;
      }>;

      "
    `)
  })

  test('ArrayOf should be handled for a complex query too', async () => {
    const schema: SchemaType = [
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'post'}},
          // Inline object array
          sections: {
            optional: true,
            type: 'objectAttribute',
            value: {
              of: {
                attributes: {
                  _key: {
                    type: 'objectAttribute',
                    value: {type: 'string'},
                  },
                  _type: {
                    type: 'objectAttribute',
                    value: {type: 'string', value: 'section'},
                  },
                  title: {
                    optional: true,
                    type: 'objectAttribute',
                    value: {type: 'string'},
                  },
                },
                type: 'object',
              },
              type: 'array',
            },
          },
          // Arrays of strings
          strings: {
            type: 'objectAttribute',
            value: {
              of: {
                type: 'string',
              },
              type: 'array',
            },
          },
          // Array of reusable types
          tags: {
            optional: true,
            type: 'objectAttribute',
            value: {
              of: {
                of: [
                  {
                    name: 'tag',
                    type: 'inline',
                  },
                  {
                    name: 'rag',
                    type: 'inline',
                  },
                ],
                type: 'union',
              },
              type: 'array',
            },
          },
        },
        name: 'post',
        type: 'document',
      },
      {
        name: 'tag',
        type: 'type',
        value: {
          attributes: {
            _key: {
              type: 'objectAttribute',
              value: {type: 'string'},
            },
            _type: {
              type: 'objectAttribute',
              value: {type: 'string', value: 'tag'},
            },
            label: {
              optional: true,
              type: 'objectAttribute',
              value: {type: 'string'},
            },
          },
          type: 'object',
        },
      },
      {
        name: 'rag',
        type: 'type',
        value: {
          attributes: {
            _key: {
              type: 'objectAttribute',
              value: {type: 'string'},
            },
            _type: {
              type: 'objectAttribute',
              value: {type: 'string', value: 'rag'},
            },
            color: {
              optional: true,
              type: 'objectAttribute',
              value: {type: 'string'},
            },
          },
          type: 'object',
        },
      },
    ]

    // eslint-disable-next-line unicorn/consistent-function-scoping
    async function* getQueries(): AsyncGenerator<ExtractedModule> {
      yield {
        errors: [],
        filename: '/src/foo.ts',
        queries: [
          {
            filename: '/src/foo.ts',
            query: `*[_type == "post"]{
              sections[]{
                ...,
                "_key": 123
              },
              "surpriseField": coalesce(tags[_type == "rag"], *[_type == 'post'][0].strings, 123)
            }`,
            variable: {id: {name: 'STRANGE_QUERY', type: 'Identifier'}},
          },
        ],
      }
    }

    const typeGenerator = new TypeGenerator()
    const {code} = await typeGenerator.generateTypes({
      overloadClientMethods: false,
      queries: getQueries(),
      root: '/src',
      schema,
    })

    expect(code).toMatchSnapshot()
  })

  test('should handle required image array member', async () => {
    const schema: SchemaType = [
      {
        attributes: {
          images: {
            type: 'objectAttribute',
            value: {
              of: {
                attributes: {
                  asset: {
                    optional: false, // <-- exported with --enforce-required-fields
                    type: 'objectAttribute',
                    value: {
                      attributes: {
                        _ref: {
                          type: 'objectAttribute',
                          value: {
                            type: 'string',
                          },
                        },
                        _type: {
                          type: 'objectAttribute',
                          value: {
                            type: 'string',
                            value: 'reference',
                          },
                        },
                      },
                      dereferencesTo: 'sanity.imageAsset',
                      type: 'object',
                    },
                  },
                },
                type: 'object',
              },
              type: 'array',
            },
          },
        },
        name: 'author',
        type: 'document',
      },
    ]

    const typeGenerator = new TypeGenerator()
    const result = await typeGenerator.generateTypes({schema})

    expect(result.code).toMatchInlineSnapshot(`
      "export type Author = {
        images: Array<{
          asset: {
            _ref: string;
            _type: "reference";
            [internalGroqTypeReferenceTo]?: "sanity.imageAsset";
          };
        }>;
      };

      export type AllSanitySchemaTypes = Author;

      export declare const internalGroqTypeReferenceTo: unique symbol;

      type ArrayOf<T> = Array<T & {
        _key: string;
      }>;

      "
    `)
  })
})
