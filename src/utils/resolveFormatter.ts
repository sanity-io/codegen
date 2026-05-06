import {type FormatGeneratedCode} from '../readConfig.js'
import {debug} from './debug.js'

/**
 * A resolved formatter function that takes a filename and text, and returns formatted text.
 */
export type FormatterFn = (filename: string, text: string) => Promise<string>

/**
 * The result of resolving a formatter.
 */
export interface ResolvedFormatter {
  /** The formatter function, or undefined if no formatter was found */
  format: FormatterFn | undefined
  /** The name of the resolved formatter, for display purposes */
  name: string | undefined
}

// Wrapper to avoid lint rule against dynamic imports
// eslint-disable-next-line no-restricted-syntax
const tryImport = (specifier: string) => import(specifier)

/**
 * Resolves a code formatter based on the `formatGeneratedCode` configuration.
 *
 * Resolution:
 * - `false` → no formatter
 * - `true` | `'prettier'` → prettier (always available as a dependency)
 * - `'oxfmt'` → oxfmt, throws if not installed
 *
 * @param formatGeneratedCode - The formatter mode to resolve
 */
export async function resolveFormatter(
  formatGeneratedCode: FormatGeneratedCode,
): Promise<ResolvedFormatter> {
  if (formatGeneratedCode === false) {
    return {format: undefined, name: undefined}
  }

  if (formatGeneratedCode === 'oxfmt') {
    return resolveOxfmt()
  }

  // true or 'prettier' → use prettier
  return resolvePrettier()
}

async function resolveOxfmt(): Promise<ResolvedFormatter> {
  try {
    const oxfmt = await tryImport('oxfmt')
    const format = oxfmt.format ?? oxfmt.default?.format
    if (typeof format !== 'function') {
      throw new TypeError('oxfmt module does not export a format function')
    }
    return {
      format: async (filename: string, text: string) => {
        const result = await format(filename, text)
        if (result.errors && result.errors.length > 0) {
          throw new Error('Failed to format generated code with oxfmt', {cause: result.errors})
        }
        return result.code
      },
      name: 'oxfmt',
    }
  } catch (err) {
    throw new Error(
      'formatGeneratedCode is set to "oxfmt" but oxfmt could not be loaded. ' +
        'Make sure oxfmt is installed as a dependency in your project. ' +
        'See: https://oxc.rs/docs/guide/usage/formatter/quickstart.html',
      {cause: err},
    )
  }
}

async function resolvePrettier(): Promise<ResolvedFormatter> {
  try {
    const prettier = await tryImport('prettier')
    const format = prettier.format ?? prettier.default?.format
    const resolveConfig = prettier.resolveConfig ?? prettier.default?.resolveConfig
    if (typeof format !== 'function') {
      throw new TypeError('prettier module does not export a format function')
    }
    return {
      format: async (filename: string, text: string) => {
        const prettierConfig =
          typeof resolveConfig === 'function' ? await resolveConfig(filename) : undefined
        return format(text, {
          ...prettierConfig,
          parser: 'typescript' as const,
        })
      },
      name: 'prettier',
    }
  } catch (err) {
    debug('prettier not available: %s', err instanceof Error ? err.message : err)
    return {format: undefined, name: undefined}
  }
}
