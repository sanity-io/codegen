import {describe, expect, test} from 'vitest'

import {swiftNestedTypeName, swiftPropertyName, swiftTypeName} from '../identifiers.js'

describe('swiftTypeName', () => {
  test('PascalCases ordinary schema names', () => {
    expect(swiftTypeName('post')).toBe('Post')
    expect(swiftTypeName('block_content')).toBe('BlockContent')
    expect(swiftTypeName('author')).toBe('Author')
  })

  test('suffixes Sanity on Swift stdlib collisions', () => {
    expect(swiftTypeName('Type')).toBe('TypeSanity')
    expect(swiftTypeName('Error')).toBe('ErrorSanity')
    expect(swiftTypeName('Any')).toBe('AnySanity')
  })

  test('suffixes Sanity on Swift keyword collisions', () => {
    expect(swiftTypeName('class')).toBe('ClassSanity')
    expect(swiftTypeName('func')).toBe('FuncSanity')
    expect(swiftTypeName('protocol')).toBe('ProtocolSanity')
  })
})

describe('swiftPropertyName', () => {
  test('keeps verbatim property names including leading underscores', () => {
    expect(swiftPropertyName('_id')).toBe('_id')
    expect(swiftPropertyName('_type')).toBe('_type')
    expect(swiftPropertyName('_createdAt')).toBe('_createdAt')
    expect(swiftPropertyName('publishedAt')).toBe('publishedAt')
  })

  test('backtick-escapes Swift reserved-word properties', () => {
    expect(swiftPropertyName('func')).toBe('`func`')
    expect(swiftPropertyName('class')).toBe('`class`')
    expect(swiftPropertyName('protocol')).toBe('`protocol`')
    expect(swiftPropertyName('init')).toBe('`init`')
  })

  test('does not escape non-keyword camelCase fields', () => {
    expect(swiftPropertyName('title')).toBe('title')
    expect(swiftPropertyName('isPublished')).toBe('isPublished')
  })
})

describe('swiftNestedTypeName', () => {
  test('composes parent + field as PascalCase', () => {
    expect(swiftNestedTypeName('Post', 'body')).toBe('PostBody')
    expect(swiftNestedTypeName('Post', 'authorRef')).toBe('PostAuthorRef')
    expect(swiftNestedTypeName('Post', 'snake_case_field')).toBe('PostSnakeCaseField')
  })
})
