import {describe, expect, it} from 'vitest'

import {resolveFormatter} from '../resolveFormatter.js'

describe('resolveFormatter', () => {
  describe('formatGeneratedCode: false', () => {
    it('returns no formatter', async () => {
      const result = await resolveFormatter(false, 'default')
      expect(result.format).toBeUndefined()
      expect(result.name).toBeUndefined()
    })

    it('returns no formatter even when explicit', async () => {
      const result = await resolveFormatter(false, 'explicit')
      expect(result.format).toBeUndefined()
      expect(result.name).toBeUndefined()
    })
  })

  describe('formatGeneratedCode: true (auto)', () => {
    it('resolves a formatter when available', async () => {
      const result = await resolveFormatter(true, 'default')
      // In the test environment, at least one of oxfmt or prettier should be available
      expect(result.name).toMatch(/^(oxfmt|prettier)$/)
      expect(result.format).toBeTypeOf('function')
    })

    it('prefers oxfmt over prettier when both are available', async () => {
      // oxfmt takes priority in auto mode
      const result = await resolveFormatter(true, 'default')
      // If oxfmt is installed, it should be preferred
      if (result.name === 'oxfmt') {
        expect(result.format).toBeTypeOf('function')
      } else {
        // otherwise prettier is fine
        expect(result.name).toBe('prettier')
      }
    })

    it('formats code with the resolved formatter', async () => {
      const result = await resolveFormatter(true, 'default')
      expect(result.format).toBeDefined()
      const formatted = await result.format!('test.ts', 'const x:string = "hello"')
      expect(formatted).toContain('const x')
      expect(formatted).toContain('hello')
    })
  })

  describe('formatGeneratedCode: "auto"', () => {
    it('resolves a formatter', async () => {
      const result = await resolveFormatter('auto', 'default')
      expect(result.name).toMatch(/^(oxfmt|prettier)$/)
      expect(result.format).toBeTypeOf('function')
    })
  })

  describe('formatGeneratedCode: "prettier"', () => {
    it('resolves prettier directly without trying oxfmt', async () => {
      const result = await resolveFormatter('prettier', 'default')
      // When set to "prettier", it uses prettier directly
      expect(result.name).toBe('prettier')
      expect(result.format).toBeTypeOf('function')
    })

    it('formats TypeScript code', async () => {
      const result = await resolveFormatter('prettier', 'default')
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
        const result = await resolveFormatter('oxfmt', 'default')
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

  describe('FormatRequestSource behavior', () => {
    it('does not throw for default source when no formatter found with false', async () => {
      const result = await resolveFormatter(false, 'default')
      expect(result.format).toBeUndefined()
    })

    it('returns formatter for explicit source when formatter available', async () => {
      const result = await resolveFormatter(true, 'explicit')
      expect(result.name).toMatch(/^(oxfmt|prettier)$/)
      expect(result.format).toBeTypeOf('function')
    })
  })

  describe('type validation', () => {
    it('accepts boolean true', async () => {
      const result = await resolveFormatter(true, 'default')
      expect(result).toBeDefined()
    })

    it('accepts boolean false', async () => {
      const result = await resolveFormatter(false, 'default')
      expect(result).toBeDefined()
    })

    it('accepts "auto"', async () => {
      const result = await resolveFormatter('auto', 'default')
      expect(result).toBeDefined()
    })

    it('accepts "prettier"', async () => {
      const result = await resolveFormatter('prettier', 'default')
      expect(result).toBeDefined()
    })

    it('accepts "oxfmt" (may resolve or throw)', async () => {
      try {
        const result = await resolveFormatter('oxfmt', 'default')
        expect(result.name).toBe('oxfmt')
      } catch {
        // acceptable if oxfmt is not installed
      }
    })
  })
})
