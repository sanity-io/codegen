import {readFile} from 'node:fs/promises'

import json5 from 'json5'
import * as z from 'zod'

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
