import * as t from '@babel/types'
import {describe, expect, test} from 'vitest'

import {topologicalSortDeclarations} from '../topologicalSort.js'

function makeDeclaration(name: string, tsType: t.TSType) {
  const id = t.identifier(name)
  const typeAlias = t.tsTypeAliasDeclaration(id, null, tsType)
  const ast = t.exportNamedDeclaration(typeAlias)
  return {ast, code: `export type ${name} = ...;\n\n`, id, name, tsType}
}

function ref(name: string): t.TSTypeReference {
  return t.tsTypeReference(t.identifier(name))
}

describe('topologicalSortDeclarations', () => {
  test('returns empty array for empty input', () => {
    expect(topologicalSortDeclarations([])).toEqual([])
  })

  test('returns single declaration unchanged', () => {
    const decl = makeDeclaration('Foo', t.tsStringKeyword())
    expect(topologicalSortDeclarations([decl])).toEqual([decl])
  })

  test('preserves order when there are no cross-references', () => {
    const foo = makeDeclaration('Foo', t.tsStringKeyword())
    const bar = makeDeclaration('Bar', t.tsNumberKeyword())
    const baz = makeDeclaration('Baz', t.tsBooleanKeyword())

    const result = topologicalSortDeclarations([foo, bar, baz])
    expect(result.map((d) => d.name)).toEqual(['Foo', 'Bar', 'Baz'])
  })

  test('sorts a simple dependency: B depends on A', () => {
    // B references A, so A should come first
    const a = makeDeclaration('A', t.tsStringKeyword())
    const b = makeDeclaration('B', ref('A'))

    // Input: B before A
    const result = topologicalSortDeclarations([b, a])
    expect(result.map((d) => d.name)).toEqual(['A', 'B'])
  })

  test('sorts a chain: C → B → A', () => {
    const a = makeDeclaration('A', t.tsStringKeyword())
    const b = makeDeclaration('B', ref('A'))
    const c = makeDeclaration('C', ref('B'))

    // Input: C, B, A (reverse order)
    const result = topologicalSortDeclarations([c, b, a])
    expect(result.map((d) => d.name)).toEqual(['A', 'B', 'C'])
  })

  test('sorts when dependency is in a union type', () => {
    const slug = makeDeclaration('Slug', t.tsStringKeyword())
    const post = makeDeclaration(
      'Post',
      t.tsTypeLiteral([
        t.tsPropertySignature(t.identifier('slug'), t.tsTypeAnnotation(ref('Slug'))),
      ]),
    )

    const result = topologicalSortDeclarations([post, slug])
    expect(result.map((d) => d.name)).toEqual(['Slug', 'Post'])
  })

  test('sorts when dependency is nested in an object type', () => {
    const imageHotspot = makeDeclaration('SanityImageHotspot', t.tsStringKeyword())
    const imageCrop = makeDeclaration('SanityImageCrop', t.tsStringKeyword())
    const blockContent = makeDeclaration(
      'BlockContent',
      t.tsTypeLiteral([
        t.tsPropertySignature(
          t.identifier('hotspot'),
          t.tsTypeAnnotation(ref('SanityImageHotspot')),
        ),
        t.tsPropertySignature(t.identifier('crop'), t.tsTypeAnnotation(ref('SanityImageCrop'))),
      ]),
    )

    const result = topologicalSortDeclarations([blockContent, imageHotspot, imageCrop])
    const names = result.map((d) => d.name)

    // Both SanityImageHotspot and SanityImageCrop should come before BlockContent
    expect(names.indexOf('SanityImageHotspot')).toBeLessThan(names.indexOf('BlockContent'))
    expect(names.indexOf('SanityImageCrop')).toBeLessThan(names.indexOf('BlockContent'))
  })

  test('handles multiple types depending on the same type', () => {
    const slug = makeDeclaration('Slug', t.tsStringKeyword())
    const post = makeDeclaration(
      'Post',
      t.tsTypeLiteral([
        t.tsPropertySignature(t.identifier('slug'), t.tsTypeAnnotation(ref('Slug'))),
      ]),
    )
    const author = makeDeclaration(
      'Author',
      t.tsTypeLiteral([
        t.tsPropertySignature(t.identifier('slug'), t.tsTypeAnnotation(ref('Slug'))),
      ]),
    )

    const result = topologicalSortDeclarations([post, author, slug])
    const names = result.map((d) => d.name)

    // Slug should come before both Post and Author
    expect(names.indexOf('Slug')).toBeLessThan(names.indexOf('Post'))
    expect(names.indexOf('Slug')).toBeLessThan(names.indexOf('Author'))
  })

  test('handles circular references by preserving original order for cycle members', () => {
    // Post references Author, Author references Post — a cycle
    const post = makeDeclaration(
      'Post',
      t.tsTypeLiteral([
        t.tsPropertySignature(t.identifier('author'), t.tsTypeAnnotation(ref('Author'))),
      ]),
    )
    const author = makeDeclaration(
      'Author',
      t.tsTypeLiteral([
        t.tsPropertySignature(t.identifier('posts'), t.tsTypeAnnotation(ref('Post'))),
      ]),
    )

    // Both are in a cycle, so they should appear in original order
    const result = topologicalSortDeclarations([post, author])
    expect(result.map((d) => d.name)).toEqual(['Post', 'Author'])
  })

  test('sorts non-cycle types before cycle types that depend on them', () => {
    // Slug has no deps, Post and Author form a cycle, both depend on Slug
    const slug = makeDeclaration('Slug', t.tsStringKeyword())
    const post = makeDeclaration(
      'Post',
      t.tsTypeLiteral([
        t.tsPropertySignature(t.identifier('author'), t.tsTypeAnnotation(ref('Author'))),
        t.tsPropertySignature(t.identifier('slug'), t.tsTypeAnnotation(ref('Slug'))),
      ]),
    )
    const author = makeDeclaration(
      'Author',
      t.tsTypeLiteral([
        t.tsPropertySignature(t.identifier('posts'), t.tsTypeAnnotation(ref('Post'))),
        t.tsPropertySignature(t.identifier('slug'), t.tsTypeAnnotation(ref('Slug'))),
      ]),
    )

    const result = topologicalSortDeclarations([post, author, slug])
    const names = result.map((d) => d.name)

    // Slug should come before the cycle members
    expect(names.indexOf('Slug')).toBeLessThan(names.indexOf('Post'))
    expect(names.indexOf('Slug')).toBeLessThan(names.indexOf('Author'))
  })

  test('ignores references to unknown types (not in the declaration set)', () => {
    const foo = makeDeclaration(
      'Foo',
      t.tsTypeLiteral([
        t.tsPropertySignature(t.identifier('bar'), t.tsTypeAnnotation(ref('ExternalType'))),
      ]),
    )
    const baz = makeDeclaration('Baz', t.tsStringKeyword())

    const result = topologicalSortDeclarations([foo, baz])
    // ExternalType is not in the set, so Foo has no known deps — order preserved
    expect(result.map((d) => d.name)).toEqual(['Foo', 'Baz'])
  })

  test('handles self-referencing types', () => {
    // A type that references itself (e.g., a tree node)
    const treeNode = makeDeclaration(
      'TreeNode',
      t.tsTypeLiteral([
        t.tsPropertySignature(
          t.identifier('children'),
          t.tsTypeAnnotation(
            t.tsTypeReference(
              t.identifier('Array'),
              t.tsTypeParameterInstantiation([ref('TreeNode')]),
            ),
          ),
        ),
      ]),
    )

    const result = topologicalSortDeclarations([treeNode])
    expect(result.map((d) => d.name)).toEqual(['TreeNode'])
  })

  test('handles dependencies in union types', () => {
    const cat = makeDeclaration('Cat', t.tsStringKeyword())
    const dog = makeDeclaration('Dog', t.tsStringKeyword())
    const pet = makeDeclaration('Pet', t.tsUnionType([ref('Cat'), ref('Dog')]))

    const result = topologicalSortDeclarations([pet, cat, dog])
    const names = result.map((d) => d.name)

    expect(names.indexOf('Cat')).toBeLessThan(names.indexOf('Pet'))
    expect(names.indexOf('Dog')).toBeLessThan(names.indexOf('Pet'))
  })

  test('handles dependencies in intersection types', () => {
    const base = makeDeclaration('Base', t.tsStringKeyword())
    const mixin = makeDeclaration('Mixin', t.tsStringKeyword())
    const combined = makeDeclaration('Combined', t.tsIntersectionType([ref('Base'), ref('Mixin')]))

    const result = topologicalSortDeclarations([combined, base, mixin])
    const names = result.map((d) => d.name)

    expect(names.indexOf('Base')).toBeLessThan(names.indexOf('Combined'))
    expect(names.indexOf('Mixin')).toBeLessThan(names.indexOf('Combined'))
  })

  test('handles dependencies in array type parameters', () => {
    const item = makeDeclaration('Item', t.tsStringKeyword())
    const list = makeDeclaration(
      'List',
      t.tsTypeReference(t.identifier('Array'), t.tsTypeParameterInstantiation([ref('Item')])),
    )

    const result = topologicalSortDeclarations([list, item])
    expect(result.map((d) => d.name)).toEqual(['Item', 'List'])
  })

  test('realistic Sanity schema ordering', () => {
    // Simulates a real Sanity schema where built-in types are referenced
    // by document types but appear later in the schema array
    const blockContent = makeDeclaration(
      'BlockContent',
      t.tsTypeLiteral([
        t.tsPropertySignature(
          t.identifier('hotspot'),
          t.tsTypeAnnotation(ref('SanityImageHotspot')),
        ),
        t.tsPropertySignature(t.identifier('crop'), t.tsTypeAnnotation(ref('SanityImageCrop'))),
      ]),
    )
    const post = makeDeclaration(
      'Post',
      t.tsTypeLiteral([
        t.tsPropertySignature(t.identifier('slug'), t.tsTypeAnnotation(ref('Slug'))),
        t.tsPropertySignature(t.identifier('body'), t.tsTypeAnnotation(ref('BlockContent'))),
        t.tsPropertySignature(t.identifier('author'), t.tsTypeAnnotation(ref('Author'))),
      ]),
    )
    const author = makeDeclaration(
      'Author',
      t.tsTypeLiteral([
        t.tsPropertySignature(t.identifier('slug'), t.tsTypeAnnotation(ref('Slug'))),
      ]),
    )
    const slug = makeDeclaration('Slug', t.tsStringKeyword())
    const sanityImageCrop = makeDeclaration('SanityImageCrop', t.tsStringKeyword())
    const sanityImageHotspot = makeDeclaration('SanityImageHotspot', t.tsStringKeyword())

    // Input order: document types first, then built-in types (typical Sanity schema extract order)
    const result = topologicalSortDeclarations([
      blockContent,
      post,
      author,
      slug,
      sanityImageCrop,
      sanityImageHotspot,
    ])
    const names = result.map((d) => d.name)

    // All leaf types should come before types that reference them
    expect(names.indexOf('Slug')).toBeLessThan(names.indexOf('Post'))
    expect(names.indexOf('Slug')).toBeLessThan(names.indexOf('Author'))
    expect(names.indexOf('SanityImageHotspot')).toBeLessThan(names.indexOf('BlockContent'))
    expect(names.indexOf('SanityImageCrop')).toBeLessThan(names.indexOf('BlockContent'))
    expect(names.indexOf('BlockContent')).toBeLessThan(names.indexOf('Post'))
    expect(names.indexOf('Author')).toBeLessThan(names.indexOf('Post'))
  })
})
