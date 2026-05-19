import {describe, expect, it} from 'vitest'

import {detectTypegenConflict, parseTypegenConfig} from '../readConfig.js'

describe('detectTypegenConflict', () => {
  it('throws with the contract error message when both forms are present', () => {
    const raw = {
      generates: './sanity.types.ts',
      schema: './schema.json',
      typescript: {
        generates: './sanity.types.ts',
        schema: './schema.json',
      },
    }

    expect(() => detectTypegenConflict(raw)).toThrowError(
      'typegen has both legacy fields and per-language blocks; use one form',
    )
  })

  it('throws when any K_LEGACY key is mixed with any K_NEW key', () => {
    const raw = {
      formatGeneratedCode: false,
      go: {generates: './pkg/types.go', schema: './schema.json'},
    }

    expect(() => detectTypegenConflict(raw)).toThrowError(
      /typegen has both legacy fields and per-language blocks/,
    )
  })

  it('does not throw on a pure legacy block', () => {
    expect(() =>
      detectTypegenConflict({
        generates: './sanity.types.ts',
        schema: './schema.json',
      }),
    ).not.toThrow()
  })

  it('does not throw on a pure new block', () => {
    expect(() =>
      detectTypegenConflict({
        go: {generates: './pkg/sanity.gen.go', schema: './schema.json'},
        typescript: {generates: './sanity.types.ts', schema: './schema.json'},
      }),
    ).not.toThrow()
  })

  it('parseTypegenConfig surfaces the same conflict before any further work', () => {
    expect(() =>
      parseTypegenConfig({
        schema: './schema.json',
        typescript: {schema: './schema.json'},
      }),
    ).toThrowError('typegen has both legacy fields and per-language blocks; use one form')
  })
})
