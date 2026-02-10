import {describe, expect, test} from 'vitest'

import {singularize} from '../singularize.js'

describe('singularize', () => {
  test('strips trailing -s', () => {
    expect(singularize('posts')).toBe('post')
    expect(singularize('images')).toBe('image')
    expect(singularize('authors')).toBe('author')
    expect(singularize('tags')).toBe('tag')
  })

  test('converts -ies to -y', () => {
    expect(singularize('categories')).toBe('category')
    expect(singularize('entries')).toBe('entry')
    expect(singularize('stories')).toBe('story')
  })

  test('strips -es from sibilant endings', () => {
    expect(singularize('addresses')).toBe('address')
    expect(singularize('bushes')).toBe('bush')
    expect(singularize('matches')).toBe('match')
    expect(singularize('boxes')).toBe('box')
    expect(singularize('buzzes')).toBe('buzz')
  })

  test('does not strip from words ending in -ss', () => {
    expect(singularize('lass')).toBe('lass')
    expect(singularize('boss')).toBe('boss')
  })

  test('returns short words unchanged', () => {
    expect(singularize('us')).toBe('us')
    expect(singularize('is')).toBe('is')
  })

  test('returns non-plural words unchanged', () => {
    expect(singularize('child')).toBe('child')
    expect(singularize('data')).toBe('data')
  })
})
