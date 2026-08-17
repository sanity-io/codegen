import {readFile} from 'node:fs/promises'

import json5 from 'json5'
import * as v from 'valibot'

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
export const configDefinition = v.object({
  formatGeneratedCode: v.optional(v.union([v.boolean(), v.picklist(['oxfmt', 'prettier'])]), true),
  generates: v.optional(v.string(), './sanity.types.ts'),
  overloadClientMethods: v.optional(v.boolean(), true),
  path: v.optional(v.union([v.string(), v.array(v.string())]), [
    './src/**/*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte}',
    './app/**/*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte}',
    './sanity/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  ]),
  schema: v.optional(v.string(), './schema.json'),
})

/** @public */
export type TypeGenConfig = v.InferOutput<typeof configDefinition>

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
    return v.parseAsync(configDefinition, json)
  } catch (error) {
    if (v.isValiError(error)) {
      throw new TypeError(
        `Error in config file\n ${error.issues.map((issue) => issue.message).join('\n')}`,
        {cause: error},
      )
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return v.parse(configDefinition, {})
    }

    throw error
  }
}
