import {createRequire} from 'node:module'

import createDebug from 'debug'
import {createMatchPath, loadConfig as loadTSConfig} from 'tsconfig-paths'

const require = createRequire(import.meta.url)
const debug = createDebug('sanity:codegen:moduleResolver')
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']

function resolveModule(request: string, options?: {paths?: string[]}): string {
  try {
    return require.resolve(request, options)
  } catch (error) {
    if (!isModuleNotFoundError(error)) throw error
  }

  for (const extension of SOURCE_EXTENSIONS) {
    try {
      return require.resolve(`${request}${extension}`, options)
    } catch (error) {
      if (!isModuleNotFoundError(error)) throw error
    }
  }

  for (const extension of SOURCE_EXTENSIONS) {
    try {
      return require.resolve(`${request}/index${extension}`, options)
    } catch (error) {
      if (!isModuleNotFoundError(error)) throw error
    }
  }

  return require.resolve(request, options)
}

function isModuleNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND'
}

/**
 * This is a custom implementation of require.resolve that takes into account the paths
 * configuration in tsconfig.json. This is necessary if we want to resolve paths that are
 * custom defined in the tsconfig.json file.
 * Resolving here is best effort and might not work in all cases.
 * @beta
 */
export function getResolver(cwd?: string): NodeJS.RequireResolve {
  const tsConfig = loadTSConfig(cwd)

  if (tsConfig.resultType === 'failed') {
    debug('Could not load tsconfig, using default resolver: %s', tsConfig.message)
    return Object.assign(resolveModule, {paths: require.resolve.paths})
  }

  const matchPath = createMatchPath(
    tsConfig.absoluteBaseUrl,
    tsConfig.paths,
    tsConfig.mainFields,
    tsConfig.addMatchAll,
  )

  const resolve = function (request: string, options?: {paths?: string[]}): string {
    const found = matchPath(request, undefined, undefined, SOURCE_EXTENSIONS)
    if (found !== undefined) {
      return resolveModule(found, options)
    }
    return resolveModule(request, options)
  }

  // wrap the resolve.path function to make it available.
  resolve.paths = (request: string): string[] | null => {
    return require.resolve.paths(request)
  }
  return resolve
}
