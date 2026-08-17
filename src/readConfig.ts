import {readFile} from 'node:fs/promises'

import json5 from 'json5'
import * as z from 'zod/mini'

/**
 * The formatter to use for generated code.
 * - `false` - Do not format generated code.
 * - `true` - Format with the built-in Babel formatter.
 * - `'prettier'` - Format with prettier. Throws if prettier is not installed.
 * - `'oxfmt'` - Format with oxfmt. Throws if oxfmt is not installed.
 * @public
 */
export type FormatGeneratedCode = 'oxfmt' | 'prettier' | boolean

/**
 * @public
 */
export const configDefinition = z.object({
  formatGeneratedCode: z._default(z.union([z.boolean(), z.enum(['oxfmt', 'prettier'])]), true),
  generates: z._default(z.string(), './sanity.types.ts'),
  overloadClientMethods: z._default(z.boolean(), true),
  path: z._default(z.union([z.string(), z.array(z.string())]), [
    './src/**/*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte}',
    './app/**/*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte}',
    './sanity/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  ]),
  schema: z._default(z.string(), './schema.json'),
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
    // eslint-disable-next-line import-x/no-named-as-default-member -- json5 is CJS and doesn't support named exports
    const json = json5.parse(content)
    return configDefinition.parseAsync(json)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'issues' in error &&
      Array.isArray(error.issues)
    ) {
      throw new TypeError(
        `Error in config file\n ${error.issues.map((err: {message: string}) => err.message).join('\n')}`,
        {cause: error},
      )
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return configDefinition.parse({})
    }

    throw error
  }
}
