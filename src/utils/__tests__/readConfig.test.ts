import {describe, expect, it} from 'vitest'

import {configDefinition} from '../../readConfig.js'

describe('configDefinition', () => {
  describe('formatGeneratedCode', () => {
    it('defaults to oxfmt when not provided', () => {
      const config = configDefinition.parse({})
      expect(config.formatGeneratedCode).toBe('oxfmt')
    })

    it('accepts boolean true', () => {
      const config = configDefinition.parse({formatGeneratedCode: true})
      expect(config.formatGeneratedCode).toBe(true)
    })

    it('accepts boolean false', () => {
      const config = configDefinition.parse({formatGeneratedCode: false})
      expect(config.formatGeneratedCode).toBe(false)
    })

    it('accepts "auto"', () => {
      const config = configDefinition.parse({formatGeneratedCode: 'auto'})
      expect(config.formatGeneratedCode).toBe('auto')
    })

    it('accepts "oxfmt"', () => {
      const config = configDefinition.parse({formatGeneratedCode: 'oxfmt'})
      expect(config.formatGeneratedCode).toBe('oxfmt')
    })

    it('accepts "prettier"', () => {
      const config = configDefinition.parse({formatGeneratedCode: 'prettier'})
      expect(config.formatGeneratedCode).toBe('prettier')
    })

    it('rejects invalid string values', () => {
      expect(() => configDefinition.parse({formatGeneratedCode: 'biome'})).toThrow()
    })

    it('rejects numeric values', () => {
      expect(() => configDefinition.parse({formatGeneratedCode: 42})).toThrow()
    })
  })
})
