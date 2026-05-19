import {readFile} from 'node:fs/promises'

import json5 from 'json5'
import * as z from 'zod'

import {type LanguageId} from './polyglot/index.js'

/**
 * The formatter to use for generated code.
 * - `false` - Do not format generated code.
 * - `true` | `'prettier'` - Format with prettier.
 * - `'oxfmt'` - Format with oxfmt. Throws if oxfmt is not installed.
 * @public
 */
export type FormatGeneratedCode = 'oxfmt' | 'prettier' | boolean

/**
 * @public
 */
export const configDefinition = z.object({
  formatGeneratedCode: z.union([z.boolean(), z.enum(['oxfmt', 'prettier'])]).default(true),
  generates: z.string().default('./sanity.types.ts'),
  overloadClientMethods: z.boolean().default(true),
  path: z
    .string()
    .or(z.array(z.string()))
    .default([
      './src/**/*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte}',
      './app/**/*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte}',
      './sanity/**/*.{ts,tsx,js,jsx,mjs,cjs}',
    ]),
  schema: z.string().default('./schema.json'),
})

/** @public */
export type TypeGenConfig = z.infer<typeof configDefinition>

/**
 * @deprecated use TypeGenConfig
 * @public
 */
export type CodegenConfig = TypeGenConfig

/**
 * Raw user input to the `typegen` field — either the legacy flat shape or the new
 * per-language nested shape. Validation happens in {@link parseTypegenConfig}.
 * @public
 */
export interface TypegenConfigInput {
  enabled?: boolean
  formatGeneratedCode?: FormatGeneratedCode
  generates?: string
  go?: unknown
  overloadClientMethods?: boolean
  path?: string | string[]
  php?: unknown
  schema?: string
  swift?: unknown
  typescript?: unknown
}

/** Keys that mark the new per-language shape. */
const K_NEW: readonly LanguageId[] = ['typescript', 'go', 'php', 'swift']

/** Keys that mark the legacy flat TypeScript shape (excluding `enabled`). */
const K_LEGACY = [
  'schema',
  'generates',
  'path',
  'overloadClientMethods',
  'formatGeneratedCode',
] as const

const LEGACY_DEPRECATION_WARNING =
  "The flat 'typegen' config is deprecated. Move your fields under 'typegen.typescript'.\n" +
  'See: https://www.sanity.io/docs/help/configuring-typegen-in-sanity-cli-config'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const present = (block: Record<string, unknown>, keys: readonly string[]): string[] =>
  keys.filter((k) => block[k] !== undefined)

/**
 * Throws when the user has populated both legacy flat fields and per-language
 * sub-blocks on the same `typegen` block (FR-005). The orchestrator calls this
 * after the zod shape validation and before any I/O.
 * @public
 */
export function detectTypegenConflict(raw: unknown): void {
  if (!isRecord(raw)) return
  const newKeys = present(raw, K_NEW)
  const legacyKeys = present(raw, K_LEGACY)
  if (newKeys.length > 0 && legacyKeys.length > 0) {
    throw new Error('typegen has both legacy fields and per-language blocks; use one form')
  }
}

/** @public */
export interface ParsedTypegenConfig {
  form: 'empty' | 'legacy' | 'new'
  /** Raw per-language sub-blocks keyed by id. Each `LanguageGenerator.parseConfig` validates further. */
  languages: Partial<Record<LanguageId, unknown>>
  warnings: string[]
}

/**
 * Detects whether a raw `typegen` block uses the legacy flat shape or the new
 * per-language shape, throws on a mixed shape, and returns the per-language raw
 * sub-blocks plus any warnings the CLI should surface.
 * @public
 */
export function parseTypegenConfig(raw: unknown): ParsedTypegenConfig {
  if (raw === undefined || raw === null) {
    return {form: 'empty', languages: {}, warnings: []}
  }
  if (!isRecord(raw)) {
    throw new Error('typegen config must be an object; received: ' + typeof raw)
  }

  detectTypegenConflict(raw)

  const newKeys = present(raw, K_NEW)
  const legacyKeys = present(raw, K_LEGACY)

  if (newKeys.length === 0 && legacyKeys.length === 0) {
    return {form: 'empty', languages: {}, warnings: []}
  }

  if (newKeys.length > 0) {
    const languages: Partial<Record<LanguageId, unknown>> = {}
    for (const id of K_NEW) {
      if (raw[id] !== undefined) {
        languages[id] = raw[id]
      }
    }
    return {form: 'new', languages, warnings: []}
  }

  // Legacy flat form — fold into typescript sub-block.
  const tsBlock: Record<string, unknown> = {}
  for (const k of K_LEGACY) {
    if (raw[k] !== undefined) tsBlock[k] = raw[k]
  }
  return {
    form: 'legacy',
    languages: {typescript: tsBlock},
    warnings: [LEGACY_DEPRECATION_WARNING],
  }
}

/**
 * Read, parse and process a config file
 * @internal
 */
export async function readConfig(path: string): Promise<TypeGenConfig> {
  try {
    const content = await readFile(path, 'utf8')
    const json = json5.parse(content)
    return configDefinition.parseAsync(json)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Error in config file\n ${error.issues.map((err) => err.message).join('\n')}`,
        {cause: error},
      )
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return configDefinition.parse({})
    }

    throw error
  }
}
