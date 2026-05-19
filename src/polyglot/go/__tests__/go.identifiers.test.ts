import {describe, expect, test} from 'vitest'

import {goFieldName, goNestedStructName, goTypeName} from '../identifiers.js'

describe('goTypeName', () => {
  test('PascalCases schema document names', () => {
    expect(goTypeName('post', 'document')).toBe('Post')
    expect(goTypeName('block_content', 'document')).toBe('BlockContent')
    expect(goTypeName('article-summary', 'document')).toBe('ArticleSummary')
  })

  test('suffixes document types named like Go keywords with "Doc"', () => {
    expect(goTypeName('type', 'document')).toBe('TypeDoc')
    expect(goTypeName('func', 'document')).toBe('FuncDoc')
    expect(goTypeName('map', 'document')).toBe('MapDoc')
  })

  test('suffixes named (non-document) types named like Go keywords with "Type"', () => {
    expect(goTypeName('type', 'type')).toBe('TypeType')
    expect(goTypeName('interface', 'type')).toBe('InterfaceType')
    expect(goTypeName('chan', 'type')).toBe('ChanType')
  })
})

describe('goFieldName', () => {
  test('PascalCases schema field names', () => {
    expect(goFieldName('title')).toBe('Title')
    expect(goFieldName('publishedAt')).toBe('PublishedAt')
    expect(goFieldName('snake_case_field')).toBe('SnakeCaseField')
  })

  test('handles leading underscores by stripping them', () => {
    expect(goFieldName('_id')).toBe('Id')
    expect(goFieldName('_type')).toBe('Type')
    expect(goFieldName('_createdAt')).toBe('CreatedAt')
  })

  test('reserved-keyword field names get capitalized (escapes the keyword for free)', () => {
    expect(goFieldName('type')).toBe('Type')
    expect(goFieldName('func')).toBe('Func')
    expect(goFieldName('chan')).toBe('Chan')
    expect(goFieldName('map')).toBe('Map')
    expect(goFieldName('interface')).toBe('Interface')
    expect(goFieldName('range')).toBe('Range')
  })
})

describe('goNestedStructName', () => {
  test('combines parent struct name and field name in PascalCase', () => {
    expect(goNestedStructName('Post', 'slug')).toBe('PostSlug')
    expect(goNestedStructName('Author', 'social_media_links')).toBe('AuthorSocialMediaLinks')
  })
})
