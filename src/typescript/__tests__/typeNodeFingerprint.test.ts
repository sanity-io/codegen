import {type ObjectTypeNode, type TypeNode} from 'groq-js'
import {describe, expect, test} from 'vitest'

import {
  buildDeduplicationRegistry,
  collectObjectFingerprints,
  fingerprintTypeNode,
} from '../typeNodeFingerprint.js'

// helpers for building TypeNode trees
function str(value?: string): TypeNode {
  return value === undefined ? {type: 'string'} : {type: 'string', value}
}

function num(value?: number): TypeNode {
  return value === undefined ? {type: 'number'} : {type: 'number', value}
}

function bool(value?: boolean): TypeNode {
  return value === undefined ? {type: 'boolean'} : {type: 'boolean', value}
}

function nullNode(): TypeNode {
  return {type: 'null'}
}

function unknown(): TypeNode {
  return {type: 'unknown'}
}

function inline(name: string): TypeNode {
  return {name, type: 'inline'}
}

function arr(of: TypeNode): TypeNode {
  return {of, type: 'array'}
}

function union(...of: TypeNode[]): TypeNode {
  return {of, type: 'union'}
}

function attr(
  value: TypeNode,
  optional?: boolean,
): {optional?: boolean; type: 'objectAttribute'; value: TypeNode} {
  return optional ? {optional, type: 'objectAttribute', value} : {type: 'objectAttribute', value}
}

function obj(
  attributes: Record<string, {optional?: boolean; type: 'objectAttribute'; value: TypeNode}>,
  extra?: {dereferencesTo?: string; rest?: ObjectTypeNode},
): ObjectTypeNode {
  return {attributes, type: 'object', ...extra}
}

describe('typeNodeFingerprint', () => {
  describe('fingerprintTypeNode', () => {
    test('primitives without values', () => {
      expect(fingerprintTypeNode(str())).toBe('s')
      expect(fingerprintTypeNode(num())).toBe('n')
      expect(fingerprintTypeNode(bool())).toBe('b')
      expect(fingerprintTypeNode(nullNode())).toBe('null')
      expect(fingerprintTypeNode(unknown())).toBe('?')
    })

    test('primitives with values', () => {
      expect(fingerprintTypeNode(str('hello'))).toBe('s:"hello"')
      expect(fingerprintTypeNode(num(42))).toBe('n:42')
      expect(fingerprintTypeNode(bool(true))).toBe('b:true')
      expect(fingerprintTypeNode(bool(false))).toBe('b:false')
    })

    test('inline type', () => {
      expect(fingerprintTypeNode(inline('Post'))).toBe('@Post')
    })

    test('array', () => {
      expect(fingerprintTypeNode(arr(str()))).toBe('[s]')
      expect(fingerprintTypeNode(arr(arr(num())))).toBe('[[n]]')
    })

    test('union members are sorted', () => {
      const a = union(str(), num(), bool())
      const b = union(bool(), str(), num())
      expect(fingerprintTypeNode(a)).toBe(fingerprintTypeNode(b))
    })

    test('object attributes are sorted by key', () => {
      const a = obj({a: attr(num()), z: attr(str())})
      const b = obj({a: attr(num()), z: attr(str())})
      expect(fingerprintTypeNode(a)).toBe(fingerprintTypeNode(b))
    })

    test('object with optional attributes', () => {
      const required = obj({title: attr(str())})
      const optional = obj({title: attr(str(), true)})
      expect(fingerprintTypeNode(required)).not.toBe(fingerprintTypeNode(optional))
      expect(fingerprintTypeNode(optional)).toContain('title?:')
    })

    test('object with rest', () => {
      const base = obj({a: attr(str())})
      const withRest = obj({a: attr(str())}, {rest: obj({b: attr(num())})})
      expect(fingerprintTypeNode(base)).not.toBe(fingerprintTypeNode(withRest))
      expect(fingerprintTypeNode(withRest)).toContain('@rest')
    })

    test('object with dereferencesTo', () => {
      const base = obj({a: attr(str())})
      const withDeref = obj({a: attr(str())}, {dereferencesTo: 'author'})
      expect(fingerprintTypeNode(base)).not.toBe(fingerprintTypeNode(withDeref))
      expect(fingerprintTypeNode(withDeref)).toContain('->>author')
    })

    test('structurally identical objects produce identical fingerprints', () => {
      const a = obj({
        _id: attr(str()),
        tags: attr(arr(str())),
        title: attr(str(), true),
      })
      const b = obj({
        _id: attr(str()),
        tags: attr(arr(str())),
        title: attr(str(), true),
      })
      expect(fingerprintTypeNode(a)).toBe(fingerprintTypeNode(b))
    })
  })

  // -- collectObjectFingerprints --

  describe('collectObjectFingerprints', () => {
    test('counts duplicate objects', () => {
      const shape = obj({_id: attr(str()), name: attr(str())})
      const result = collectObjectFingerprints([shape, shape])
      const fp = fingerprintTypeNode(shape)
      expect(result.get(fp)?.count).toBe(2)
    })

    test('walks into nested objects and counts them', () => {
      const inner = obj({name: attr(str())})
      const outer = obj({author: attr(inner)})
      // inner appears once inside outer, but if we pass two copies of outer,
      // inner appears twice
      const result = collectObjectFingerprints([outer, outer])
      const innerFp = fingerprintTypeNode(inner)
      expect(result.get(innerFp)?.count).toBe(2)
    })

    test('uses _type attribute as candidate name', () => {
      const node = obj({
        _type: attr(str('image')),
        url: attr(str()),
      })
      const result = collectObjectFingerprints([node, node])
      const fp = fingerprintTypeNode(node)
      expect(result.get(fp)?.candidateName).toBe('image')
    })

    test('uses parent key as candidate name when _type is absent', () => {
      const inner = obj({name: attr(str())})
      const outer = obj({author: attr(inner)})
      const result = collectObjectFingerprints([outer])
      const innerFp = fingerprintTypeNode(inner)
      expect(result.get(innerFp)?.candidateName).toBe('author')
    })

    test('singularizes parent key through arrays', () => {
      const item = obj({title: attr(str())})
      const outer = obj({posts: attr(arr(item))})
      const result = collectObjectFingerprints([outer])
      const itemFp = fingerprintTypeNode(item)
      expect(result.get(itemFp)?.candidateName).toBe('post')
    })

    test('singularizes -ies to -y', () => {
      const item = obj({name: attr(str())})
      const outer = obj({categories: attr(arr(item))})
      const result = collectObjectFingerprints([outer])
      const itemFp = fingerprintTypeNode(item)
      expect(result.get(itemFp)?.candidateName).toBe('category')
    })

    test('singularizes -sses by stripping -es', () => {
      const item = obj({line1: attr(str())})
      const outer = obj({addresses: attr(arr(item))})
      const result = collectObjectFingerprints([outer])
      const itemFp = fingerprintTypeNode(item)
      expect(result.get(itemFp)?.candidateName).toBe('address')
    })

    test('propagates parent key through unions', () => {
      const variant = obj({value: attr(str())})
      const outer = obj({hero: attr(union(variant, str()))})
      const result = collectObjectFingerprints([outer])
      const variantFp = fingerprintTypeNode(variant)
      expect(result.get(variantFp)?.candidateName).toBe('hero')
    })

    test('candidate name is null when no _type and no parent key', () => {
      const node = obj({name: attr(str())})
      const result = collectObjectFingerprints([node])
      const fp = fingerprintTypeNode(node)
      expect(result.get(fp)?.candidateName).toBeNull()
    })
  })

  describe('buildDeduplicationRegistry', () => {
    test('only extracts types with count >= 2', () => {
      const node = obj({name: attr(str())})
      const fp = fingerprintTypeNode(node)
      const fingerprints = new Map([[fp, {candidateName: 'test', count: 1, typeNode: node}]])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())
      expect(registry.extractedTypes.size).toBe(0)
    })

    test('extracts types with count >= 2', () => {
      const node = obj({bio: attr(str()), name: attr(str())})
      const fp = fingerprintTypeNode(node)
      const fingerprints = new Map([[fp, {candidateName: 'author', count: 2, typeNode: node}]])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())
      expect(registry.extractedTypes.size).toBe(1)
      expect(registry.extractedTypes.get(fp)?.id.name).toBe('InlineAuthor')
    })

    test('skips types with fewer than 2 meaningful attributes', () => {
      const trivial = obj({name: attr(str())})
      const fp = fingerprintTypeNode(trivial)
      const fingerprints = new Map([[fp, {candidateName: 'item', count: 5, typeNode: trivial}]])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())
      expect(registry.extractedTypes.size).toBe(0)
    })

    test('does not count _key, _type, _ref as meaningful attributes', () => {
      const structural = obj({_key: attr(str()), _type: attr(str('image')), url: attr(str())})
      const fp = fingerprintTypeNode(structural)
      const fingerprints = new Map([[fp, {candidateName: 'image', count: 2, typeNode: structural}]])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())
      expect(registry.extractedTypes.size).toBe(0)
    })

    test('falls back to InlineType when no candidate name', () => {
      const node = obj({x: attr(num()), y: attr(num())})
      const fp = fingerprintTypeNode(node)
      const fingerprints = new Map([[fp, {candidateName: null, count: 3, typeNode: node}]])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())
      expect(registry.extractedTypes.get(fp)?.id.name).toBe('InlineType')
    })

    test('avoids collisions with existing identifiers', () => {
      const node = obj({bio: attr(str()), name: attr(str())})
      const fp = fingerprintTypeNode(node)
      const fingerprints = new Map([[fp, {candidateName: 'slug', count: 2, typeNode: node}]])
      const existing = new Set(['InlineSlug'])
      const registry = buildDeduplicationRegistry(fingerprints, existing)
      expect(registry.extractedTypes.get(fp)?.id.name).toBe('InlineSlug_2')
    })

    test('avoids collisions between extracted types', () => {
      const nodeA = obj({a: attr(str()), b: attr(str())})
      const nodeB = obj({c: attr(num()), d: attr(num())})
      const fpA = fingerprintTypeNode(nodeA)
      const fpB = fingerprintTypeNode(nodeB)
      const fingerprints = new Map([
        [fpA, {candidateName: 'item', count: 2, typeNode: nodeA}],
        [fpB, {candidateName: 'item', count: 2, typeNode: nodeB}],
      ])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())
      const names = [...registry.extractedTypes.values()].map((e) => e.id.name)
      expect(names).toHaveLength(2)
      expect(new Set(names).size).toBe(2) // all unique
      expect(names).toContain('InlineItem')
      expect(names).toContain('InlineItem_2')
    })

    test('preserves typeNode reference in extracted entries', () => {
      const node = obj({body: attr(str()), title: attr(str())})
      const fp = fingerprintTypeNode(node)
      const fingerprints = new Map([[fp, {candidateName: 'post', count: 3, typeNode: node}]])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())
      expect(registry.extractedTypes.get(fp)?.typeNode).toBe(node)
    })

    test('capitalizes first letter of candidate name', () => {
      const node = obj({x: attr(num()), y: attr(num())})
      const fp = fingerprintTypeNode(node)
      const fingerprints = new Map([[fp, {candidateName: 'point', count: 2, typeNode: node}]])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())
      expect(registry.extractedTypes.get(fp)?.id.name).toBe('InlinePoint')
    })

    test('exactly 2 meaningful attributes is the threshold for extraction', () => {
      const twoMeaningful = obj({
        _type: attr(str('img')),
        alt: attr(str()),
        url: attr(str()),
      })
      const fp = fingerprintTypeNode(twoMeaningful)
      const fingerprints = new Map([
        [fp, {candidateName: 'img', count: 2, typeNode: twoMeaningful}],
      ])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())
      expect(registry.extractedTypes.size).toBe(1)
    })
  })

  describe('end-to-end: collectObjectFingerprints → buildDeduplicationRegistry', () => {
    test('full pipeline extracts duplicated nested objects', () => {
      const inner = obj({slug: attr(str()), title: attr(str())})
      const outer1 = obj({extra: attr(num()), post: attr(inner)})
      const outer2 = obj({other: attr(bool()), post: attr(inner)})

      const fingerprints = collectObjectFingerprints([outer1, outer2])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())

      const innerFp = fingerprintTypeNode(inner)
      expect(registry.extractedTypes.has(innerFp)).toBe(true)
      expect(registry.extractedTypes.get(innerFp)?.id.name).toBe('InlinePost')
    })

    test('does not extract objects that only appear once', () => {
      const a = obj({bio: attr(str()), name: attr(str())})
      const b = obj({slug: attr(str()), title: attr(str())})

      const fingerprints = collectObjectFingerprints([a, b])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())

      expect(registry.extractedTypes.size).toBe(0)
    })

    test('does not merge objects that differ only in value types', () => {
      const a = obj({name: attr(str()), score: attr(num())})
      const b = obj({name: attr(str()), score: attr(str())})

      expect(fingerprintTypeNode(a)).not.toBe(fingerprintTypeNode(b))

      const fingerprints = collectObjectFingerprints([a, a, b, b])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())

      // Both appear 2+ times, so both should be extracted — separately
      expect(registry.extractedTypes.size).toBe(2)
    })

    test('does not merge objects that differ only in optionality', () => {
      const required = obj({email: attr(str()), name: attr(str())})
      const optional = obj({email: attr(str(), true), name: attr(str())})

      expect(fingerprintTypeNode(required)).not.toBe(fingerprintTypeNode(optional))

      const fingerprints = collectObjectFingerprints([required, required, optional, optional])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())

      expect(registry.extractedTypes.size).toBe(2)
    })

    test('does not merge objects with different keys', () => {
      const withTitle = obj({name: attr(str()), title: attr(str())})
      const withSlug = obj({name: attr(str()), slug: attr(str())})

      expect(fingerprintTypeNode(withTitle)).not.toBe(fingerprintTypeNode(withSlug))

      const fingerprints = collectObjectFingerprints([withTitle, withTitle, withSlug, withSlug])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())

      expect(registry.extractedTypes.size).toBe(2)
      const names = [...registry.extractedTypes.values()].map((e) => e.id.name)
      expect(names).not.toContain(names[0] === names[1] ? names[0] : undefined)
    })

    test('does not merge objects that differ only in _type literal value', () => {
      const post = obj({_type: attr(str('post')), body: attr(str()), title: attr(str())})
      const page = obj({_type: attr(str('page')), body: attr(str()), title: attr(str())})

      expect(fingerprintTypeNode(post)).not.toBe(fingerprintTypeNode(page))

      const fingerprints = collectObjectFingerprints([post, post, page, page])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())

      expect(registry.extractedTypes.size).toBe(2)
      const names = [...registry.extractedTypes.values()].map((e) => e.id.name).toSorted()
      expect(names).toEqual(['InlinePage', 'InlinePost'])
    })

    test('does not merge objects that differ in nested structure', () => {
      const innerA = obj({x: attr(num()), y: attr(num())})
      const innerB = obj({x: attr(str()), y: attr(str())})
      const outerA = obj({coords: attr(innerA), label: attr(str())})
      const outerB = obj({coords: attr(innerB), label: attr(str())})

      expect(fingerprintTypeNode(outerA)).not.toBe(fingerprintTypeNode(outerB))

      const fingerprints = collectObjectFingerprints([outerA, outerA, outerB, outerB])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())

      // outerA, outerB, innerA, innerB are all distinct — 4 extracted types
      expect(registry.extractedTypes.size).toBe(4)
    })

    test('snapshot of registry for complex type tree', () => {
      const image = obj({
        _type: attr(str('image')),
        alt: attr(str()),
        url: attr(str()),
      })
      const author = obj({
        _type: attr(str('author')),
        avatar: attr(image),
        name: attr(str()),
      })
      const post1 = obj({
        author: attr(author),
        hero: attr(image),
        title: attr(str()),
      })
      const post2 = obj({
        author: attr(author),
        thumbnail: attr(image),
        title: attr(str()),
      })

      const fingerprints = collectObjectFingerprints([post1, post2])
      const registry = buildDeduplicationRegistry(fingerprints, new Set())

      const extracted = [...registry.extractedTypes.values()].map((e) => e.id.name).toSorted()
      expect(extracted).toEqual(['InlineAuthor', 'InlineImage'])
    })
  })

  describe('fingerprintTypeNode snapshots', () => {
    test('snapshot of fingerprints for various node shapes', () => {
      const results = {
        array_of_objects: fingerprintTypeNode(arr(obj({id: attr(str()), name: attr(str())}))),
        boolean_literal: fingerprintTypeNode(bool(true)),
        deeply_nested: fingerprintTypeNode(
          obj({
            items: attr(
              arr(
                obj({
                  tags: attr(arr(str())),
                  value: attr(num()),
                }),
              ),
            ),
          }),
        ),
        empty_object: fingerprintTypeNode(obj({})),
        inline: fingerprintTypeNode(inline('Slug')),
        null: fingerprintTypeNode(nullNode()),
        number: fingerprintTypeNode(num()),
        object_with_deref: fingerprintTypeNode(obj({_ref: attr(str())}, {dereferencesTo: 'post'})),
        object_with_rest: fingerprintTypeNode(obj({a: attr(str())}, {rest: obj({b: attr(num())})})),
        simple_object: fingerprintTypeNode(obj({age: attr(num()), name: attr(str())})),
        string: fingerprintTypeNode(str()),
        string_literal: fingerprintTypeNode(str('hello')),
        union: fingerprintTypeNode(union(str(), num(), nullNode())),
        unknown: fingerprintTypeNode(unknown()),
      }
      expect(results).toEqual({
        array_of_objects: '[{id:s,name:s}]',
        boolean_literal: 'b:true',
        deeply_nested: '{items:[{tags:[s],value:n}]}',
        empty_object: '{}',
        inline: '@Slug',
        null: 'null',
        number: 'n',
        object_with_deref: '{_ref:s->>post}',
        object_with_rest: '{a:s@rest{b:n}}',
        simple_object: '{age:n,name:s}',
        string: 's',
        string_literal: 's:"hello"',
        union: '(n|null|s)',
        unknown: '?',
      })
    })
  })
})
