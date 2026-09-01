import fs from 'node:fs/promises'

import {type ParserOptions} from '@babel/parser'
import createDebug from 'debug'
import glob from 'globby'

import {findQueriesInSource} from './findQueriesInSource.js'
import {normalizeGlobPattern} from './helpers.js'
import {getResolver} from './moduleResolver.js'
import {type ExtractedModule, QueryExtractionError} from './types.js'

const debug = createDebug('sanity:codegen:findQueries:debug')

interface FindQueriesInPathOptions {
  path: string | string[]

  parserOptions?: ParserOptions
  resolver?: NodeJS.RequireResolve
}

/**
 * findQueriesInPath takes a path or array of paths and returns all GROQ queries in the files.
 * @param path - The path or array of paths to search for queries
 * @param parserOptions - Additional Babel parser options
 * @param resolver - A resolver function to use when resolving module imports
 * @returns An async generator that yields the results of the search
 * @beta
 * @internal
 */
export function findQueriesInPath({
  parserOptions,
  path,
  resolver = getResolver(),
}: FindQueriesInPathOptions): {files: string[]; queries: AsyncIterable<ExtractedModule>} {
  const queryNames = new Set()
  // Holds all query names found in the source files
  debug(`Globing ${path}`)

  // Normalize glob patterns to use forward slashes on all platforms
  const normalizedPath = normalizeGlobPattern(path)

  const files = glob
    .sync(normalizedPath, {
      absolute: false,
      ignore: ['**/node_modules/**'], // we never want to look in node_modules
      onlyFiles: true,
    })
    .toSorted()

  async function* getQueries(): AsyncGenerator<ExtractedModule> {
    for (const filename of files) {
      if (typeof filename !== 'string') {
        continue
      }

      debug(`Found file "${filename}"`)
      try {
        const source = await fs.readFile(filename, 'utf8')
        const pluckedModuleResult = findQueriesInSource(source, filename, parserOptions, resolver)
        // Check and error on duplicate query names, because we can't generate types with the same name.
        for (const {variable} of pluckedModuleResult.queries) {
          if (queryNames.has(variable.id.name)) {
            throw new Error(
              `Duplicate query name found: "${variable.id.name}". Query names must be unique across all files.`,
            )
          }
          queryNames.add(variable.id.name)
        }

        yield pluckedModuleResult
      } catch (cause) {
        debug(`Error in file "${filename}"`, cause)

        yield {
          errors: [new QueryExtractionError({cause, filename})],
          filename,
          queries: [],
        }
      }
    }
  }

  return {files, queries: getQueries()}
}
