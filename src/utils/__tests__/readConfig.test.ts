import * as v from 'valibot'
import {describe, expect, it} from 'vitest'

import {configDefinition} from '../../readConfig.js'

describe('configDefinition', () => {
  describe('formatGeneratedCode', () => {
    it('defaults to true when not provided', () => {
      const config = v.parse(configDefinition, {})
      expect(config.formatGeneratedCode).toBe(true)
    })

    it('accepts boolean true', () => {
      const config = v.parse(configDefinition, {formatGeneratedCode: true})
      expect(config.formatGeneratedCode).toBe(true)
    })

    it('accepts boolean false', () => {
      const config = v.parse(configDefinition, {formatGeneratedCode: false})
      expect(config.formatGeneratedCode).toBe(false)
    })

    it('accepts "oxfmt"', () => {
      const config = v.parse(configDefinition, {formatGeneratedCode: 'oxfmt'})
      expect(config.formatGeneratedCode).toBe('oxfmt')
    })

    it('accepts "prettier"', () => {
      const config = v.parse(configDefinition, {formatGeneratedCode: 'prettier'})
      expect(config.formatGeneratedCode).toBe('prettier')
    })

    it('rejects invalid string values', () => {
      expect(() => v.parse(configDefinition, {formatGeneratedCode: 'biome'})).toThrow()
    })

    it('rejects numeric values', () => {
      expect(() => v.parse(configDefinition, {formatGeneratedCode: 42})).toThrow()
    })
  })
})
