import {describe, expect, it} from 'vitest'

import {prepareConfig} from '../config.js'

describe('prepareConfig', () => {
  it('returns default values when called with undefined', () => {
    const config = prepareConfig(undefined)

    expect(config).toEqual({
      formatGeneratedCode: false,
      generates: 'sanity.types.ts',
      overloadClientMethods: false,
      path: './src/**/*.{ts,tsx,js,jsx}',
      schema: 'schema.json',
    })
  })

  it('returns default values when called with empty object', () => {
    const config = prepareConfig({})

    expect(config).toEqual({
      formatGeneratedCode: false,
      generates: 'sanity.types.ts',
      overloadClientMethods: false,
      path: './src/**/*.{ts,tsx,js,jsx}',
      schema: 'schema.json',
    })
  })

  it('preserves provided values', () => {
    const config = prepareConfig({
      formatGeneratedCode: true,
      generates: 'custom.types.ts',
      overloadClientMethods: true,
      path: './custom/**/*.ts',
      schema: 'custom-schema.json',
    })

    expect(config).toEqual({
      formatGeneratedCode: true,
      generates: 'custom.types.ts',
      overloadClientMethods: true,
      path: './custom/**/*.ts',
      schema: 'custom-schema.json',
    })
  })

  it('merges partial config with defaults', () => {
    const config = prepareConfig({
      formatGeneratedCode: true,
      generates: 'my-types.ts',
    })

    expect(config).toEqual({
      formatGeneratedCode: true,
      generates: 'my-types.ts',
      overloadClientMethods: false,
      path: './src/**/*.{ts,tsx,js,jsx}',
      schema: 'schema.json',
    })
  })

  it('handles explicit false values correctly', () => {
    const config = prepareConfig({
      formatGeneratedCode: false,
      overloadClientMethods: false,
    })

    expect(config.formatGeneratedCode).toBe(false)
    expect(config.overloadClientMethods).toBe(false)
  })
})
