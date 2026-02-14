import {hashTypeNode, type ObjectTypeNode, type TypeNode} from 'groq-js'
import {describe, expect, test} from 'vitest'

import {buildDeduplicationRegistry, collectObjectFingerprints} from '../typeNodeFingerprint.js'

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

describe('collectObjectFingerprints', () => {
  test('counts duplicate objects', () => {
    const shape = obj({_id: attr(str()), name: attr(str())})
    const result = collectObjectFingerprints([shape, shape])
    const fp = hashTypeNode(shape)
    expect(result.get(fp)?.count).toBe(2)
  })

  test('walks into nested objects and counts them', () => {
    const inner = obj({name: attr(str())})
    const outer = obj({author: attr(inner)})
    const result = collectObjectFingerprints([outer, outer])
    const innerFp = hashTypeNode(inner)
    expect(result.get(innerFp)?.count).toBe(2)
  })

  test('uses _type attribute as candidate name', () => {
    const node = obj({
      _type: attr(str('image')),
      url: attr(str()),
    })
    const result = collectObjectFingerprints([node, node])
    const fp = hashTypeNode(node)
    expect(result.get(fp)?.candidateName).toBe('image')
  })

  test('uses parent key as candidate name when _type is absent', () => {
    const inner = obj({name: attr(str())})
    const outer = obj({author: attr(inner)})
    const result = collectObjectFingerprints([outer])
    const innerFp = hashTypeNode(inner)
    expect(result.get(innerFp)?.candidateName).toBe('author')
  })

  test('singularizes parent key through arrays', () => {
    const item = obj({title: attr(str())})
    const outer = obj({posts: attr(arr(item))})
    const result = collectObjectFingerprints([outer])
    const itemFp = hashTypeNode(item)
    expect(result.get(itemFp)?.candidateName).toBe('post')
  })

  test('singularizes -ies to -y', () => {
    const item = obj({name: attr(str())})
    const outer = obj({categories: attr(arr(item))})
    const result = collectObjectFingerprints([outer])
    const itemFp = hashTypeNode(item)
    expect(result.get(itemFp)?.candidateName).toBe('category')
  })

  test('singularizes -sses by stripping -es', () => {
    const item = obj({line1: attr(str())})
    const outer = obj({addresses: attr(arr(item))})
    const result = collectObjectFingerprints([outer])
    const itemFp = hashTypeNode(item)
    expect(result.get(itemFp)?.candidateName).toBe('address')
  })

  test('propagates parent key through unions', () => {
    const variant = obj({value: attr(str())})
    const outer = obj({hero: attr(union(variant, str()))})
    const result = collectObjectFingerprints([outer])
    const variantFp = hashTypeNode(variant)
    expect(result.get(variantFp)?.candidateName).toBe('hero')
  })

  test('candidate name is null when no _type and no parent key', () => {
    const node = obj({name: attr(str())})
    const result = collectObjectFingerprints([node])
    const fp = hashTypeNode(node)
    expect(result.get(fp)?.candidateName).toBeNull()
  })
})

describe('buildDeduplicationRegistry', () => {
  test('only extracts types with count >= 2', () => {
    const node = obj({name: attr(str())})
    const fp = hashTypeNode(node)
    const fingerprints = new Map([[fp, {candidateName: 'test', count: 1, typeNode: node}]])
    const registry = buildDeduplicationRegistry(fingerprints, new Set())
    expect(registry.extractedTypes.size).toBe(0)
  })

  test('extracts types with count >= 2', () => {
    const node = obj({bio: attr(str()), name: attr(str())})
    const fp = hashTypeNode(node)
    const fingerprints = new Map([[fp, {candidateName: 'author', count: 2, typeNode: node}]])
    const registry = buildDeduplicationRegistry(fingerprints, new Set())
    expect(registry.extractedTypes.size).toBe(1)
    expect(registry.extractedTypes.get(fp)?.id.name).toBe('InlineAuthor')
  })

  test('skips types with fewer than 2 meaningful attributes', () => {
    const trivial = obj({name: attr(str())})
    const fp = hashTypeNode(trivial)
    const fingerprints = new Map([[fp, {candidateName: 'item', count: 5, typeNode: trivial}]])
    const registry = buildDeduplicationRegistry(fingerprints, new Set())
    expect(registry.extractedTypes.size).toBe(0)
  })

  test('does not count _key, _type, _ref as meaningful attributes', () => {
    const structural = obj({_key: attr(str()), _type: attr(str('image')), url: attr(str())})
    const fp = hashTypeNode(structural)
    const fingerprints = new Map([[fp, {candidateName: 'image', count: 2, typeNode: structural}]])
    const registry = buildDeduplicationRegistry(fingerprints, new Set())
    expect(registry.extractedTypes.size).toBe(0)
  })

  test('falls back to InlineType when no candidate name', () => {
    const node = obj({x: attr(num()), y: attr(num())})
    const fp = hashTypeNode(node)
    const fingerprints = new Map([[fp, {candidateName: null, count: 3, typeNode: node}]])
    const registry = buildDeduplicationRegistry(fingerprints, new Set())
    expect(registry.extractedTypes.get(fp)?.id.name).toBe('InlineType')
  })

  test('avoids collisions with existing identifiers', () => {
    const node = obj({bio: attr(str()), name: attr(str())})
    const fp = hashTypeNode(node)
    const fingerprints = new Map([[fp, {candidateName: 'slug', count: 2, typeNode: node}]])
    const existing = new Set(['InlineSlug'])
    const registry = buildDeduplicationRegistry(fingerprints, existing)
    expect(registry.extractedTypes.get(fp)?.id.name).toBe('InlineSlug_2')
  })

  test('avoids collisions between extracted types', () => {
    const nodeA = obj({a: attr(str()), b: attr(str())})
    const nodeB = obj({c: attr(num()), d: attr(num())})
    const fpA = hashTypeNode(nodeA)
    const fpB = hashTypeNode(nodeB)
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
    const fp = hashTypeNode(node)
    const fingerprints = new Map([[fp, {candidateName: 'post', count: 3, typeNode: node}]])
    const registry = buildDeduplicationRegistry(fingerprints, new Set())
    expect(registry.extractedTypes.get(fp)?.typeNode).toBe(node)
  })

  test('capitalizes first letter of candidate name', () => {
    const node = obj({x: attr(num()), y: attr(num())})
    const fp = hashTypeNode(node)
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
    const fp = hashTypeNode(twoMeaningful)
    const fingerprints = new Map([[fp, {candidateName: 'img', count: 2, typeNode: twoMeaningful}]])
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

    const innerFp = hashTypeNode(inner)
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

    const fingerprints = collectObjectFingerprints([a, a, b, b])
    const registry = buildDeduplicationRegistry(fingerprints, new Set())

    expect(registry.extractedTypes.size).toBe(2)
  })

  test('does not merge objects that differ only in optionality', () => {
    const required = obj({email: attr(str()), name: attr(str())})
    const optional = obj({email: attr(str(), true), name: attr(str())})

    const fingerprints = collectObjectFingerprints([required, required, optional, optional])
    const registry = buildDeduplicationRegistry(fingerprints, new Set())

    expect(registry.extractedTypes.size).toBe(2)
  })

  test('does not merge objects with different keys', () => {
    const withTitle = obj({name: attr(str()), title: attr(str())})
    const withSlug = obj({name: attr(str()), slug: attr(str())})

    const fingerprints = collectObjectFingerprints([withTitle, withTitle, withSlug, withSlug])
    const registry = buildDeduplicationRegistry(fingerprints, new Set())

    expect(registry.extractedTypes.size).toBe(2)
    const names = [...registry.extractedTypes.values()].map((e) => e.id.name)
    expect(names).not.toContain(names[0] === names[1] ? names[0] : undefined)
  })

  test('does not merge objects that differ only in _type literal value', () => {
    const post = obj({_type: attr(str('post')), body: attr(str()), title: attr(str())})
    const page = obj({_type: attr(str('page')), body: attr(str()), title: attr(str())})

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
