/**
 * Identifier helpers for the Go generator (R5 / output-files.md Go section).
 *
 * Go reserved keywords and predeclared identifiers we must avoid colliding with.
 * Keywords listed at https://go.dev/ref/spec#Keywords; predeclared types added so
 * field names like `string`/`int` don't shadow the type after PascalCase.
 */
const GO_KEYWORDS = new Set([
  'break',
  'case',
  'chan',
  'const',
  'continue',
  'default',
  'defer',
  'else',
  'fallthrough',
  'for',
  'func',
  'go',
  'goto',
  'if',
  'import',
  'interface',
  'map',
  'package',
  'range',
  'return',
  'select',
  'struct',
  'switch',
  'type',
  'var',
])

/**
 * Splits a schema identifier into word parts. Splits on non-alphanumeric characters
 * and on transitions between case (camelCase → ["camel", "Case"]).
 */
function splitIdentifier(name: string): string[] {
  const tokens: string[] = []
  let current = ''
  for (const ch of name) {
    const isAlnum = /[a-zA-Z0-9]/.test(ch)
    if (!isAlnum) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    if (current && /[a-z]/.test(current.at(-1)!) && /[A-Z]/.test(ch)) {
      tokens.push(current)
      current = ch
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)
  return tokens.map((t) => t.toLowerCase()).filter(Boolean)
}

function pascal(name: string): string {
  return splitIdentifier(name)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/**
 * Convert a schema type name (document or named object) into an exported Go identifier.
 *
 * If the schema name (case-insensitively) matches a Go keyword, suffix with the kind
 * (`Doc` for documents, `Type` for named non-document types) so we don't generate
 * `type Type struct {}`.
 */
export function goTypeName(schemaName: string, kind: 'document' | 'type'): string {
  const base = pascal(schemaName) || 'Anonymous'
  if (GO_KEYWORDS.has(schemaName.toLowerCase()) || GO_KEYWORDS.has(base.toLowerCase())) {
    return `${base}${kind === 'document' ? 'Doc' : 'Type'}`
  }
  return base
}

/**
 * Convert a schema field name into an exported Go field name. PascalCase the field;
 * since Go field names must be exported (uppercase first letter) to participate in
 * `encoding/json`, the capitalization itself is enough to escape reserved keywords
 * like `type`/`func`/`map` (which are all-lowercase). The original wire name is
 * preserved by the caller via the `json:"…"` struct tag.
 */
export function goFieldName(schemaField: string): string {
  // Special-case leading underscores so `_id` → `Id`, `_type` → `Type`, etc.
  const stripped = schemaField.replace(/^_+/, '')
  const base = pascal(stripped) || pascal(schemaField) || 'Field'
  return base
}

/**
 * Build a nested-struct type name from its parent struct and field path. Example:
 * `goNestedStructName('Post', 'slug') === 'PostSlug'`.
 */
export function goNestedStructName(parent: string, field: string): string {
  return `${parent}${pascal(field)}`
}
