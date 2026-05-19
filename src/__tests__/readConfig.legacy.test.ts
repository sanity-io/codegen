import {describe, expect, it} from 'vitest'

import {parseTypegenConfig} from '../readConfig.js'

describe('parseTypegenConfig (legacy flat form)', () => {
  it('detects the legacy flat shape and folds it into typescript', () => {
    const result = parseTypegenConfig({
      generates: './sanity.types.ts',
      overloadClientMethods: true,
      path: './src/**/*.ts',
      schema: './schema.json',
    })

    expect(result.form).toBe('legacy')
    expect(result.languages.typescript).toEqual({
      generates: './sanity.types.ts',
      overloadClientMethods: true,
      path: './src/**/*.ts',
      schema: './schema.json',
    })
    expect(result.languages.go).toBeUndefined()
    expect(result.languages.php).toBeUndefined()
    expect(result.languages.swift).toBeUndefined()
  })

  it('emits a deprecation warning pointing at the help doc', () => {
    const result = parseTypegenConfig({
      generates: './sanity.types.ts',
      schema: './schema.json',
    })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain(
      "The flat 'typegen' config is deprecated. Move your fields under 'typegen.typescript'.",
    )
    expect(result.warnings[0]).toContain(
      'https://www.sanity.io/docs/help/configuring-typegen-in-sanity-cli-config',
    )
  })

  it('treats partial legacy fields as legacy form', () => {
    const result = parseTypegenConfig({formatGeneratedCode: false})

    expect(result.form).toBe('legacy')
    expect(result.languages.typescript).toEqual({formatGeneratedCode: false})
  })
})
