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
  })
})
