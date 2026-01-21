import path from 'node:path'

import {CodeGenerator} from '@babel/generator'
import * as t from '@babel/types'
import {type ArrayTypeNode, type UnionTypeNode} from 'groq-js'

import {formatPath} from '../utils/formatPath.js'
import {RESERVED_IDENTIFIERS} from './constants.js'

export function normalizePrintablePath(root: string, filename: string) {
  const resolved = path.resolve(root, filename)
  // Always use Unix-style paths for consistent output across platforms
  return formatPath(path.relative(root, resolved))
}

/**
 * Normalizes a glob pattern to use forward slashes (POSIX-style paths).
 * Glob patterns must use forward slashes, even on Windows.
 *
 * @param pattern - A glob pattern string or array of patterns
 * @returns The normalized pattern(s) with forward slashes
 * @see https://github.com/sindresorhus/globby#api
 */
export function normalizeGlobPattern(pattern: string | string[]): string | string[] {
  if (Array.isArray(pattern)) {
    return pattern.map((p) => formatPath(p))
  }
  return formatPath(pattern)
}

function sanitizeIdentifier(input: string): string {
  return `${input.replace(/^\d/, '_').replaceAll(/[^$\w]+(.)/g, (_, char) => char.toUpperCase())}`
}

/**
 * Checks if a string is a valid ECMAScript IdentifierName.
 * IdentifierNames start with a letter, underscore, or $, and contain only
 * alphanumeric characters, underscores, or $.
 */
export function isIdentifierName(input: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(input)
}

function normalizeIdentifier(input: string): string {
  const sanitized = sanitizeIdentifier(input)
  return `${sanitized.charAt(0).toUpperCase()}${sanitized.slice(1)}`
}

export function getUniqueIdentifierForName(name: string, currentIdentifiers: Set<string>) {
  const desiredName = normalizeIdentifier(name)
  let resultingName = desiredName
  let index = 2
  while (currentIdentifiers.has(resultingName) || RESERVED_IDENTIFIERS.has(resultingName)) {
    resultingName = `${desiredName}_${index}`
    index++
  }
  return t.identifier(resultingName)
}

export function computeOnce<TReturn>(fn: () => TReturn): () => TReturn {
  const ref = {computed: false, current: undefined as TReturn | undefined}

  return function () {
    if (ref.computed) return ref.current as TReturn
    ref.current = fn()
    ref.computed = true
    return ref.current
  }
}

export function weakMapMemo<TParam extends object, TReturn>(fn: (arg: TParam) => TReturn) {
  const cache = new WeakMap<object, TReturn>()

  const wrapped = function (arg: TParam) {
    if (cache.has(arg)) return cache.get(arg)!
    const result = fn(arg)
    cache.set(arg, result)
    return result
  }

  return wrapped
}

export function generateCode(node: t.Node) {
  return `${new CodeGenerator(node).generate().code.trim()}\n\n`
}

export function getFilterArrayUnionType(
  typeNode: ArrayTypeNode,
  predicate: (unionTypeNode: UnionTypeNode['of'][number]) => boolean,
): ArrayTypeNode {
  if (typeNode.of.type !== 'union') {
    return typeNode
  }

  return {
    ...typeNode,
    of: {
      ...typeNode.of,
      of: typeNode.of.of.filter((unionTypeNode) => predicate(unionTypeNode)),
    },
  } satisfies ArrayTypeNode<UnionTypeNode>
}
