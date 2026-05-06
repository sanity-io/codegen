import {describe, expect, it, vi} from 'vitest'

import {defineFormatter, resolveFormatter} from '../resolveFormatter.js'

describe('defineFormatter', () => {
  it('returns undefined for false', () => {
    expect(defineFormatter(false)).toBeUndefined()
  })

  it('returns name "prettier" for true', () => {
    const formatter = defineFormatter(true)
    expect(formatter).toBeDefined()
    expect(formatter!.name).toBe('prettier')
  })

  it('returns name "prettier" for "prettier"', () => {
    const formatter = defineFormatter('prettier')
    expect(formatter).toBeDefined()
    expect(formatter!.name).toBe('prettier')
  })

  it('returns name "oxfmt" for "oxfmt"', () => {
    const formatter = defineFormatter('oxfmt')
    expect(formatter).toBeDefined()
    expect(formatter!.name).toBe('oxfmt')
  })
})

describe('resolveFormatter', () => {
  describe('formatGeneratedCode: false', () => {
    it('returns no formatter', async () => {
      const result = await resolveFormatter(false)
      expect(result.format).toBeUndefined()
      expect(result.name).toBeUndefined()
    })
  })

  describe('formatGeneratedCode: true', () => {
    it('resolves prettier', async () => {
      const result = await resolveFormatter(true)
      expect(result.name).toBe('prettier')
      expect(result.format).toBeTypeOf('function')
    })

    it('formats TypeScript code', async () => {
      const result = await resolveFormatter(true)
      expect(result.format).toBeDefined()
      const formatted = await result.format!('test.ts', 'const x:string = "hello"')
      expect(formatted).toContain('const x')
      expect(formatted).toContain('hello')
    })
  })

  describe('formatGeneratedCode: "prettier"', () => {
    it('resolves prettier', async () => {
      const result = await resolveFormatter('prettier')
      expect(result.name).toBe('prettier')
      expect(result.format).toBeTypeOf('function')
    })

    it('formats TypeScript code', async () => {
      const result = await resolveFormatter('prettier')
      expect(result.format).toBeDefined()
      const formatted = await result.format!('test.ts', 'type Foo={bar:string}')
      expect(formatted).toContain('Foo')
      expect(formatted).toContain('bar')
      expect(formatted).toContain('string')
    })
  })

  describe('formatGeneratedCode: "oxfmt"', () => {
    it('resolves oxfmt when installed', async () => {
      const result = await resolveFormatter('oxfmt')
      expect(result.name).toBe('oxfmt')
      expect(result.format).toBeTypeOf('function')
    })

    it('throws a helpful error when oxfmt cannot be loaded', async () => {
      vi.doMock('oxfmt', () => {
        throw new Error('Cannot find module oxfmt')
      })

      // Re-import to pick up the mock
      const {resolveFormatter: resolveFormatterMocked} = await import('../resolveFormatter.js')

      await expect(resolveFormatterMocked('oxfmt')).rejects.toThrow(
        'formatGeneratedCode is set to "oxfmt" but oxfmt could not be loaded',
      )
      await expect(resolveFormatterMocked('oxfmt')).rejects.toThrow(
        'Make sure oxfmt is installed as a dependency',
      )

      vi.doUnmock('oxfmt')
    })
  })
})
