import {describe, expect, it} from 'vitest'

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
    it('resolves oxfmt or throws if not installed', async () => {
      try {
        const result = await resolveFormatter('oxfmt')
        // If it resolves, it must be oxfmt
        expect(result.name).toBe('oxfmt')
        expect(result.format).toBeTypeOf('function')
      } catch (err) {
        // If oxfmt is not installed, it should throw with a helpful message
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toContain(
          'formatGeneratedCode is set to "oxfmt" but oxfmt could not be loaded',
        )
        expect((err as Error).message).toContain('Make sure oxfmt is installed as a dependency')
      }
    })
  })
})
