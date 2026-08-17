import {parseAsync} from '@babel/core'
import {CodeGenerator} from '@babel/generator'

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
 * A defined formatter with a known name and an async resolve step.
 */
export interface DefinedFormatter {
  /** The name of the formatter, available synchronously */
  name: string
  /** Resolves the formatter — may throw if the formatter cannot be loaded */
  resolve: () => Promise<ResolvedFormatter>
}

// Wrapper to avoid lint rule against dynamic imports
// eslint-disable-next-line no-restricted-syntax
const tryImport = (specifier: string) => import(specifier)

/**
 * Synchronously defines a formatter based on the `formatGeneratedCode` configuration.
 * The `name` is available immediately; call `resolve()` to load the formatter (which may throw).
 *
 * Returns `undefined` if `formatGeneratedCode` is `false`.
 *
 * @param formatGeneratedCode - The formatter mode to resolve
 */
export function defineFormatter(
  formatGeneratedCode: FormatGeneratedCode,
): DefinedFormatter | undefined {
  if (formatGeneratedCode === false) {
    return undefined
  }

  if (formatGeneratedCode === 'oxfmt') {
    return {name: 'oxfmt', resolve: resolveOxfmt}
  }

  if (formatGeneratedCode === 'prettier') {
    return {name: 'prettier', resolve: resolvePrettier}
  }

  return {name: 'babel', resolve: resolveBabel}
}

/**
 * Resolves a code formatter based on the `formatGeneratedCode` configuration.
 *
 * Resolution:
 * - `false` → no formatter
 * - `true` → built-in Babel formatter
 * - `'prettier'` → prettier, throws if not installed
 * - `'oxfmt'` → oxfmt, throws if not installed
 *
 * @param formatGeneratedCode - The formatter mode to resolve
 */
export async function resolveFormatter(
  formatGeneratedCode: FormatGeneratedCode,
): Promise<ResolvedFormatter> {
  const defined = defineFormatter(formatGeneratedCode)
  if (!defined) {
    return {format: undefined, name: undefined}
  }
  return defined.resolve()
}

async function resolveBabel(): Promise<ResolvedFormatter> {
  return {
    format: async (filename: string, text: string) => {
      const ast = await parseAsync(text, {
        babelrc: false,
        configFile: false,
        filename,
        parserOpts: {
          plugins: ['typescript'],
          sourceType: 'module',
        },
      })

      if (!ast) {
        throw new Error('Failed to parse generated code with Babel')
      }

      return `${new CodeGenerator(ast, {retainLines: true}).generate().code}\n`
    },
    name: 'babel',
  }
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
    throw new Error(
      'formatGeneratedCode is set to "prettier" but prettier could not be loaded. ' +
        'Make sure prettier is installed as a dependency in your project. ' +
        'See: https://prettier.io/docs/install',
      {cause: err},
    )
  }
}
