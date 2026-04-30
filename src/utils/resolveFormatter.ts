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

/**
 * Whether the user explicitly requested formatting (as opposed to the default value).
 */
export type FormatRequestSource = 'default' | 'explicit'

// Wrapper to avoid lint rule against dynamic imports
// eslint-disable-next-line no-restricted-syntax
const tryImport = (specifier: string) => import(specifier)

/**
 * Resolves a code formatter based on the `formatGeneratedCode` configuration.
 *
 * Resolution order:
 * - `false` → no formatter
 * - `true` | `'auto'` → try oxfmt → prettier, warn if explicit and none found
 * - `'oxfmt'` → oxfmt only, error if not available
 * - `'prettier'` → prettier only, error if not available
 */
export async function resolveFormatter(
  formatGeneratedCode: FormatGeneratedCode,
  source: FormatRequestSource,
): Promise<ResolvedFormatter> {
  if (formatGeneratedCode === false) {
    return {format: undefined, name: undefined}
  }

  const mode = formatGeneratedCode === true ? 'auto' : formatGeneratedCode

  if (mode === 'oxfmt') {
    return resolveOxfmt({required: true})
  }

  if (mode === 'prettier') {
    // Use prettier directly — don't try oxfmt as it may not produce
    // identical output to the user's installed prettier version/config
    return resolvePrettier({required: true})
  }

  // mode === 'auto'
  const oxfmt = await resolveOxfmt({required: false})
  if (oxfmt.format) {
    return oxfmt
  }
  const prettier = await resolvePrettier({required: false})
  if (prettier.format) {
    return prettier
  }

  if (source === 'explicit') {
    debug('formatGeneratedCode is set to %s but no formatter (oxfmt, prettier) was found', mode)
  }

  return {format: undefined, name: undefined}
}

async function resolveOxfmt(options: {required: boolean}): Promise<ResolvedFormatter> {
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
    if (options.required) {
      throw new Error(
        'formatGeneratedCode is set to "oxfmt" but oxfmt could not be loaded. ' +
          'Make sure oxfmt is installed as a dependency. ' +
          'See: https://github.com/nicolo-ribaudo/oxfmt',
        {cause: err},
      )
    }
    debug('oxfmt not available: %s', err instanceof Error ? err.message : err)
    return {format: undefined, name: undefined}
  }
}

async function resolvePrettier(options: {required: boolean}): Promise<ResolvedFormatter> {
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
    if (options.required) {
      throw new Error(
        'formatGeneratedCode is set to "prettier" but prettier could not be loaded. ' +
          'Make sure prettier is installed as a dependency.',
        {cause: err},
      )
    }
    debug('prettier not available: %s', err instanceof Error ? err.message : err)
    return {format: undefined, name: undefined}
  }
}
