import {CodeGenerator} from '@babel/generator'
import * as t from '@babel/types'
import {type TypeNode} from 'groq-js'
import {describe, expect, test} from 'vitest'

import {SchemaTypeGenerator, walkAndCountQueryTypeNodeStats} from '../schemaTypeGenerator.js'

function generateCode(node: t.Node | undefined) {
  if (!node) throw new Error('Node is undefined')
  return new CodeGenerator(node).generate().code.trim()
}

describe(SchemaTypeGenerator.name, () => {
  test('takes in a schema and pre-computes all TS types and identifiers', () => {
    const schema = new SchemaTypeGenerator([
      {
        name: 'foo',
        type: 'type',
        value: {
          attributes: {
            _id: {type: 'objectAttribute', value: {type: 'string'}},
            _type: {type: 'objectAttribute', value: {type: 'string', value: 'foo'}},
            foo: {optional: true, type: 'objectAttribute', value: {type: 'string'}},
          },
          type: 'object',
        },
      },
      {
        name: 'bar',
        type: 'type',
        value: {
          attributes: {
            _id: {type: 'objectAttribute', value: {type: 'string'}},
            _type: {type: 'objectAttribute', value: {type: 'string', value: 'bar'}},
            bar: {optional: true, type: 'objectAttribute', value: {type: 'string'}},
          },
          type: 'object',
        },
      },
    ])

    expect(schema.typeNames()).toEqual(['foo', 'bar'])
    expect(schema.getType('foo')).toEqual({
      id: {name: 'Foo', type: 'Identifier'},
      tsType: {
        members: [
          {
            key: {name: '_id', type: 'Identifier'},
            optional: undefined,
            type: 'TSPropertySignature',
            typeAnnotation: {type: 'TSTypeAnnotation', typeAnnotation: {type: 'TSStringKeyword'}},
          },
          {
            key: {name: '_type', type: 'Identifier'},
            optional: undefined,
            type: 'TSPropertySignature',
            typeAnnotation: {
              type: 'TSTypeAnnotation',
              typeAnnotation: {
                literal: {type: 'StringLiteral', value: 'foo'},
                type: 'TSLiteralType',
              },
            },
          },
          {
            key: {name: 'foo', type: 'Identifier'},
            optional: true,
            type: 'TSPropertySignature',
            typeAnnotation: {
              type: 'TSTypeAnnotation',
              typeAnnotation: {type: 'TSStringKeyword'},
            },
          },
        ],
        type: 'TSTypeLiteral',
      },
    })
    expect(schema.hasType('baz')).toBe(false)
    expect(schema.getType('baz')).toBe(undefined)
  })

  test('throws an error if a schema has a duplicate type name', () => {
    expect(
      () =>
        new SchemaTypeGenerator([
          {
            name: 'post',
            type: 'type',
            value: {
              attributes: {foo: {type: 'objectAttribute', value: {type: 'string'}}},
              type: 'object',
            },
          },
          {
            attributes: {foo: {type: 'objectAttribute', value: {type: 'string'}}},
            name: 'post',
            type: 'document',
          },
        ]),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Duplicate type name "post" in schema. Type names must be unique within the same schema.]`,
    )
  })

  test('handles collisions when more than one type name sanitizes to the same identifier', () => {
    const schema = new SchemaTypeGenerator([
      {
        name: 'foo.bar',
        type: 'type',
        value: {
          attributes: {foo: {type: 'objectAttribute', value: {type: 'string'}}},
          type: 'object',
        },
      },
      {
        name: 'foo-bar',
        type: 'type',
        value: {
          attributes: {bar: {type: 'objectAttribute', value: {type: 'number'}}},
          type: 'object',
        },
      },
      {
        name: 'foo--bar',
        type: 'type',
        value: {
          attributes: {baz: {type: 'objectAttribute', value: {type: 'number'}}},
          type: 'object',
        },
      },
    ])
    const typeNames = schema.typeNames()
    expect(typeNames.length).toBe(3)
    expect(new Set(typeNames).size).toBe(3) // ensure type names are unique

    const [first, second, third] = [...schema]
    expect(first?.id.name).toBe('FooBar')
    expect(second?.id.name).toBe('FooBar_2')
    expect(third?.id.name).toBe('FooBar_3')
  })

  describe('generateTsType', () => {
    test('generates TS Types for strings', () => {
      const schema = new SchemaTypeGenerator([
        {
          name: 'stringAlias',
          type: 'type',
          value: {
            type: 'string',
          },
        },
        {
          name: 'stringLiteralAlias',
          type: 'type',
          value: {
            type: 'string',
            value: 'literalValue',
          },
        },
      ])

      const stringAlias = schema.getType('stringAlias')?.tsType
      const stringLiteralAlias = schema.getType('stringLiteralAlias')?.tsType

      expect(generateCode(stringAlias)).toMatchInlineSnapshot(`"string"`)
      expect(generateCode(stringLiteralAlias)).toMatchInlineSnapshot(`""literalValue""`)
    })

    test('generates TS Types for numbers', () => {
      const schema = new SchemaTypeGenerator([
        {
          name: 'numberAlias',
          type: 'type',
          value: {
            type: 'number',
          },
        },
        {
          name: 'numberLiteralAlias',
          type: 'type',
          value: {
            type: 'number',
            value: 123,
          },
        },
      ])

      const numberAlias = schema.getType('numberAlias')?.tsType
      const numberLiteralAlias = schema.getType('numberLiteralAlias')?.tsType

      expect(generateCode(numberAlias)).toMatchInlineSnapshot(`"number"`)
      expect(generateCode(numberLiteralAlias)).toMatchInlineSnapshot(`"123"`)
    })

    test('generates TS Types for booleans', () => {
      const schema = new SchemaTypeGenerator([
        {
          name: 'booleanAlias',
          type: 'type',
          value: {
            type: 'boolean',
          },
        },
        {
          name: 'booleanLiteralAlias',
          type: 'type',
          value: {
            type: 'boolean',
            value: true,
          },
        },
      ])

      const booleanAlias = schema.getType('booleanAlias')?.tsType
      const booleanLiteralAlias = schema.getType('booleanLiteralAlias')?.tsType

      expect(generateCode(booleanAlias)).toMatchInlineSnapshot(`"boolean"`)
      expect(generateCode(booleanLiteralAlias)).toMatchInlineSnapshot(`"true"`)
    })

    test('generates TS Types for unknown', () => {
      const schema = new SchemaTypeGenerator([
        {
          name: 'unknownAlias',
          type: 'type',
          value: {
            type: 'unknown',
          },
        },
      ])

      const unknownAlias = schema.getType('unknownAlias')?.tsType

      expect(generateCode(unknownAlias)).toMatchInlineSnapshot(`"unknown"`)
    })

    test('generates TS Types for null', () => {
      const schema = new SchemaTypeGenerator([
        {
          name: 'nullAlias',
          type: 'type',
          value: {
            type: 'null',
          },
        },
      ])

      const nullAlias = schema.getType('nullAlias')?.tsType

      expect(generateCode(nullAlias)).toMatchInlineSnapshot(`"null"`)
    })

    test('generates TS Types for arrays', () => {
      const schema = new SchemaTypeGenerator([
        {
          name: 'arrayAlias',
          type: 'type',
          value: {
            of: {
              type: 'string',
            },
            type: 'array',
          },
        },
      ])

      const arrayAlias = schema.getType('arrayAlias')?.tsType

      expect(generateCode(arrayAlias)).toMatchInlineSnapshot(`"Array<string>"`)
    })

    test('generates TS Types for documents', () => {
      const schema = new SchemaTypeGenerator([
        {
          attributes: {
            _createdAt: {type: 'objectAttribute', value: {type: 'string'}},
            _id: {type: 'objectAttribute', value: {type: 'string'}},
            _rev: {type: 'objectAttribute', value: {type: 'string'}},
            _type: {type: 'objectAttribute', value: {type: 'string', value: 'post'}},
            _updatedAt: {type: 'objectAttribute', value: {type: 'string'}},
            title: {optional: true, type: 'objectAttribute', value: {type: 'string'}},
          },
          name: 'post',
          type: 'document',
        },
      ])

      const post = schema.getType('post')?.tsType

      expect(generateCode(post)).toMatchInlineSnapshot(`
        "{
          _createdAt: string;
          _id: string;
          _rev: string;
          _type: "post";
          _updatedAt: string;
          title?: string;
        }"
      `)
    })

    test('generates TS Types for unions', () => {
      const schema = new SchemaTypeGenerator([
        {
          name: 'unionAlias',
          type: 'type',
          value: {of: [{type: 'string'}, {type: 'number'}], type: 'union'},
        },
        {
          name: 'emptyUnionAlias',
          type: 'type',
          value: {of: [], type: 'union'},
        },
        {
          name: 'unionOfOneAlias',
          type: 'type',
          value: {of: [{type: 'string'}], type: 'union'},
        },
      ])

      const unionAlias = schema.getType('unionAlias')?.tsType
      const emptyUnionAlias = schema.getType('emptyUnionAlias')?.tsType
      const unionOfOneAlias = schema.getType('unionOfOneAlias')?.tsType

      expect(generateCode(unionAlias)).toMatchInlineSnapshot(`"string | number"`)
      expect(generateCode(emptyUnionAlias)).toMatchInlineSnapshot(`"never"`)
      expect(generateCode(unionOfOneAlias)).toMatchInlineSnapshot(`"string"`)
      expect(t.isTSStringKeyword(unionOfOneAlias)).toBe(true)
    })

    test('generates TS Types for inline types', () => {
      const schema = new SchemaTypeGenerator([
        {
          name: 'inlineAlias',
          type: 'type',
          value: {name: 'person', type: 'inline'},
        },
        {
          name: 'person',
          type: 'type',
          value: {
            attributes: {
              age: {type: 'objectAttribute', value: {type: 'number'}},
              name: {type: 'objectAttribute', value: {type: 'string'}},
            },
            type: 'object',
          },
        },
        {
          name: 'inlineAliasWithNoMatchingType',
          type: 'type',
          value: {name: 'noMatchingType', type: 'inline'},
        },
      ])

      const inlineAlias = schema.getType('inlineAlias')?.tsType
      const inlineAliasWithNoMatchingType = schema.getType('inlineAliasWithNoMatchingType')?.tsType

      expect(generateCode(inlineAlias)).toMatchInlineSnapshot(`"Person"`)
      expect(generateCode(inlineAliasWithNoMatchingType)).toMatchInlineSnapshot(
        `"unknown // Unable to locate the referenced type "noMatchingType" in schema"`,
      )
    })

    test('quotes non-identifier keys, preserves valid identifier keys', () => {
      const schema = new SchemaTypeGenerator([
        {
          name: 'objectWithMixedKeys',
          type: 'type',
          value: {
            attributes: {
              '': {type: 'objectAttribute', value: {type: 'string'}},
              '123startsWithNumber': {type: 'objectAttribute', value: {type: 'string'}},
              $dollarKey: {type: 'objectAttribute', value: {type: 'string'}},
              _privateKey: {type: 'objectAttribute', value: {type: 'string'}},
              camelCase: {type: 'objectAttribute', value: {type: 'string'}},
              'dot.notation': {type: 'objectAttribute', value: {type: 'string'}},
              // Invalid identifiers - MUST be quoted
              'kebab-case': {type: 'objectAttribute', value: {type: 'string'}},
              // Valid identifiers - should NOT be quoted
              normalKey: {type: 'objectAttribute', value: {type: 'string'}},
              PascalCase: {type: 'objectAttribute', value: {type: 'string'}},
              'special@char': {type: 'objectAttribute', value: {type: 'string'}},
              UPPER_SNAKE: {type: 'objectAttribute', value: {type: 'string'}},
              'with spaces': {type: 'objectAttribute', value: {type: 'string'}},
            },
            type: 'object',
          },
        },
      ])

      const objectType = schema.getType('objectWithMixedKeys')?.tsType
      expect(generateCode(objectType)).toMatchInlineSnapshot(`
        "{
          "": string;
          "123startsWithNumber": string;
          $dollarKey: string;
          _privateKey: string;
          camelCase: string;
          "dot.notation": string;
          "kebab-case": string;
          normalKey: string;
          PascalCase: string;
          "special@char": string;
          UPPER_SNAKE: string;
          "with spaces": string;
        }"
      `)
    })

    test('generates TS Types for objects', () => {
      const schema = new SchemaTypeGenerator([
        {
          name: 'objectAlias',
          type: 'type',
          value: {
            attributes: {name: {type: 'objectAttribute', value: {type: 'string'}}},
            type: 'object',
          },
        },
        {
          name: 'objectWithUnknownRest',
          type: 'type',
          value: {
            attributes: {name: {type: 'objectAttribute', value: {type: 'string'}}},
            rest: {type: 'unknown'},
            type: 'object',
          },
        },
        {
          name: 'objectWithInlineRest',
          type: 'type',
          value: {
            attributes: {name: {type: 'objectAttribute', value: {type: 'string'}}},
            rest: {name: 'person', type: 'inline'},
            type: 'object',
          },
        },
        {
          name: 'objectWithUnresolvableInlineRest',
          type: 'type',
          value: {
            attributes: {name: {type: 'objectAttribute', value: {type: 'string'}}},
            rest: {name: 'unresolvableInlineRest', type: 'inline'},
            type: 'object',
          },
        },
        {
          name: 'objectWithObjectRest',
          type: 'type',
          value: {
            attributes: {name: {type: 'objectAttribute', value: {type: 'string'}}},
            rest: {
              attributes: {
                bar: {type: 'objectAttribute', value: {type: 'number'}},
                foo: {type: 'objectAttribute', value: {type: 'string'}},
              },
              type: 'object',
            },
            type: 'object',
          },
        },
        {
          name: 'person',
          type: 'type',
          value: {
            attributes: {
              age: {type: 'objectAttribute', value: {type: 'number'}},
              name: {type: 'objectAttribute', value: {type: 'string'}},
            },
            type: 'object',
          },
        },
        {
          name: 'dereferenceableObject',
          type: 'type',
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
            dereferencesTo: 'person',
            type: 'object',
          },
        },
      ])

      const objectAlias = schema.getType('objectAlias')?.tsType
      const objectWithUnknownRest = schema.getType('objectWithUnknownRest')?.tsType
      const objectWithInlineRest = schema.getType('objectWithInlineRest')?.tsType
      const objectWithUnresolvableInlineRest = schema.getType(
        'objectWithUnresolvableInlineRest',
      )?.tsType
      const objectWithObjectRest = schema.getType('objectWithObjectRest')?.tsType
      const dereferenceableObject = schema.getType('dereferenceableObject')?.tsType

      expect(generateCode(objectAlias)).toMatchInlineSnapshot(`
        "{
          name: string;
        }"
      `)
      expect(generateCode(objectWithUnknownRest)).toMatchInlineSnapshot(`"unknown"`)
      expect(generateCode(objectWithInlineRest)).toMatchInlineSnapshot(
        `
        "{
          name: string;
        } & Person"
      `,
      )
      expect(generateCode(objectWithUnresolvableInlineRest)).toMatchInlineSnapshot(
        `"unknown // Unable to locate the referenced type "unresolvableInlineRest" in schema"`,
      )
      expect(generateCode(objectWithObjectRest)).toMatchInlineSnapshot(`
        "{
          name: string;
          bar: number;
          foo: string;
        }"
      `)
      expect(generateCode(dereferenceableObject)).toMatchInlineSnapshot(`
        "{
          _ref: string;
          _type: "reference";
          [internalGroqTypeReferenceTo]?: "person";
        }"
      `)
    })
  })

  describe('evaluateQuery', () => {
    test('evaluates a query against the schema and returns the TS Type and stats', () => {
      const schema = new SchemaTypeGenerator([
        {
          attributes: {
            _createdAt: {type: 'objectAttribute', value: {type: 'string'}},
            _id: {type: 'objectAttribute', value: {type: 'string'}},
            _type: {type: 'objectAttribute', value: {type: 'string', value: 'post'}},
            _updatedAt: {type: 'objectAttribute', value: {type: 'string'}},
            title: {optional: true, type: 'objectAttribute', value: {type: 'string'}},
          },
          name: 'post',
          type: 'document',
        },
      ])

      const {stats, tsType} = schema.evaluateQuery({
        query: '*[_type == "post"]{_id, title}',
      })
      expect(generateCode(tsType)).toMatchInlineSnapshot(`
        "Array<{
          _id: string;
          title: string | null;
        }>"
      `)

      expect(stats).toMatchInlineSnapshot(`
        {
          "allTypes": 6,
          "emptyUnions": 0,
          "unknownTypes": 0,
        }
      `)
    })
  })

  describe('walkAndCountQueryTypeNodeStats', () => {
    test('counts unknown type', () => {
      const node: TypeNode = {type: 'unknown'}
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 1,
        emptyUnions: 0,
        unknownTypes: 1,
      })
    })

    test('counts primitive types', () => {
      const stringNode: TypeNode = {type: 'string'}
      const numberNode: TypeNode = {type: 'number'}
      const booleanNode: TypeNode = {type: 'boolean'}
      const nullNode: TypeNode = {type: 'null'}
      const expected = {allTypes: 1, emptyUnions: 0, unknownTypes: 0}
      expect(walkAndCountQueryTypeNodeStats(stringNode)).toEqual(expected)
      expect(walkAndCountQueryTypeNodeStats(numberNode)).toEqual(expected)
      expect(walkAndCountQueryTypeNodeStats(booleanNode)).toEqual(expected)
      expect(walkAndCountQueryTypeNodeStats(nullNode)).toEqual(expected)
    })

    test('counts array type', () => {
      const node: TypeNode = {of: {type: 'string'}, type: 'array'}
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 2, // array + string
        emptyUnions: 0,
        unknownTypes: 0,
      })
    })

    test('counts array with unknown element type', () => {
      const node: TypeNode = {of: {type: 'unknown'}, type: 'array'}
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 2, // array + unknown
        emptyUnions: 0,
        unknownTypes: 1,
      })
    })

    test('counts nested array type', () => {
      const node: TypeNode = {of: {of: {type: 'number'}, type: 'array'}, type: 'array'}
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 3, // outer array + inner array + number
        emptyUnions: 0,
        unknownTypes: 0,
      })
    })

    test('counts simple object type', () => {
      const node: TypeNode = {
        attributes: {foo: {type: 'objectAttribute', value: {type: 'string'}}},
        type: 'object',
      }
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 2, // object + string
        emptyUnions: 0,
        unknownTypes: 0,
      })
    })

    test('counts object type with multiple attributes', () => {
      const node: TypeNode = {
        attributes: {
          bar: {type: 'objectAttribute', value: {type: 'number'}},
          foo: {type: 'objectAttribute', value: {type: 'string'}},
        },
        type: 'object',
      }
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 3, // object + string + number
        emptyUnions: 0,
        unknownTypes: 0,
      })
    })

    test('counts object type with unknown rest', () => {
      const node: TypeNode = {
        attributes: {foo: {type: 'objectAttribute', value: {type: 'string'}}},
        rest: {type: 'unknown'},
        type: 'object',
      }
      // object + unknown rest = 2 types, 1 of which is unknown
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 2,
        emptyUnions: 0,
        unknownTypes: 1,
      })
    })

    test('counts object type with object rest', () => {
      const node: TypeNode = {
        attributes: {a: {type: 'objectAttribute', value: {type: 'string'}}},
        rest: {
          attributes: {b: {type: 'objectAttribute', value: {type: 'number'}}},
          type: 'object',
        },
        type: 'object',
      }
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 4, // outer object + string 'a' + rest object + rest number 'b'
        emptyUnions: 0,
        unknownTypes: 0,
      })
    })

    test('counts object type with non-unknown/non-object rest', () => {
      const node: TypeNode = {
        attributes: {a: {type: 'objectAttribute', value: {type: 'string'}}},
        rest: {name: 'person', type: 'inline'},
        type: 'object',
      }

      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 3, // outer object + string 'a' + inline 'person'
        emptyUnions: 0,
        unknownTypes: 0,
      })
    })

    test('counts empty union type', () => {
      const node: TypeNode = {of: [], type: 'union'}
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 1, // union
        emptyUnions: 1,
        unknownTypes: 0,
      })
    })

    test('counts simple union type', () => {
      const node: TypeNode = {of: [{type: 'string'}, {type: 'number'}], type: 'union'}
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 3, // union + string + number
        emptyUnions: 0,
        unknownTypes: 0,
      })
    })

    test('counts union type with unknown member', () => {
      const node: TypeNode = {of: [{type: 'string'}, {type: 'unknown'}], type: 'union'}
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 3, // union + string + unknown
        emptyUnions: 0,
        unknownTypes: 1,
      })
    })

    test('counts complex nested type', () => {
      const node: TypeNode = {
        of: {
          of: [
            {
              attributes: {
                a: {type: 'objectAttribute', value: {type: 'string'}},
                b: {type: 'objectAttribute', value: {type: 'unknown'}},
              },
              rest: {
                attributes: {
                  c: {type: 'objectAttribute', value: {type: 'boolean'}},
                },
                rest: {name: 'person', type: 'inline'},
                type: 'object',
              },
              type: 'object',
            },
            {type: 'number'},
            {of: {type: 'boolean'}, type: 'array'},
          ],
          type: 'union',
        },
        type: 'array',
      }

      // Calculation breakdown:
      // array (1)
      // + union (1)
      // + object (1)
      // + string 'a' (1)
      // + unknown 'b' (1) => unknownTypes: 1
      // + rest object (1)
      // + boolean 'c' (1)
      // + inline 'person' rest (1)
      // + number (1)
      // + inner array (1)
      // + inner boolean (1)
      // = 11 total types
      expect(walkAndCountQueryTypeNodeStats(node)).toEqual({
        allTypes: 11,
        emptyUnions: 0,
        unknownTypes: 1,
      })
    })
  })
})
