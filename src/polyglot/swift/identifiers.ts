const SWIFT_KEYWORDS = new Set([
  'as',
  'associatedtype',
  'break',
  'case',
  'catch',
  'class',
  'continue',
  'default',
  'defer',
  'deinit',
  'do',
  'else',
  'enum',
  'extension',
  'fallthrough',
  'false',
  'fileprivate',
  'for',
  'func',
  'guard',
  'if',
  'import',
  'in',
  'init',
  'inout',
  'internal',
  'is',
  'let',
  'nil',
  'open',
  'operator',
  'precedencegroup',
  'private',
  'protocol',
  'public',
  'repeat',
  'rethrows',
  'return',
  'self',
  'Self',
  'static',
  'struct',
  'subscript',
  'super',
  'switch',
  'throw',
  'throws',
  'true',
  'try',
  'typealias',
  'var',
  'where',
  'while',
])

const SWIFT_TYPE_COLLISIONS = new Set([
  'Any',
  'AnyObject',
  'Array',
  'Bool',
  'Codable',
  'Decoder',
  'Dictionary',
  'Double',
  'Encoder',
  'Error',
  'Float',
  'Identifiable',
  'Int',
  'Optional',
  'Result',
  'Sendable',
  'Set',
  'String',
  'Type',
])

function toPascalCase(name: string): string {
  if (name.length === 0) return name
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) return name
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

/**
 * PascalCase the schema name, suffixing `Sanity` on Swift-keyword/stdlib collisions
 * so Codable synthesis still works without manual CodingKeys.
 */
export function swiftTypeName(schemaName: string): string {
  const pascal = toPascalCase(schemaName)
  if (
    SWIFT_TYPE_COLLISIONS.has(pascal) ||
    SWIFT_KEYWORDS.has(pascal) ||
    SWIFT_KEYWORDS.has(schemaName)
  ) {
    return `${pascal}Sanity`
  }
  return pascal
}

/**
 * Property names are kept verbatim from the schema (including leading underscores
 * — required for Codable synthesis to decode `_id`/`_type`/`_createdAt` without
 * CodingKeys). Reserved-word names are wrapped in backticks per Swift grammar.
 */
export function swiftPropertyName(schemaFieldName: string): string {
  if (SWIFT_KEYWORDS.has(schemaFieldName)) {
    return `\`${schemaFieldName}\``
  }
  return schemaFieldName
}

/**
 * Compose a nested-object struct name from a parent struct + field name,
 * e.g. `Post` + `body` (inline element) → `PostBody`. Used for inline objects
 * and union-of-types array variants.
 */
export function swiftNestedTypeName(parent: string, field: string): string {
  return `${parent}${toPascalCase(field)}`
}
