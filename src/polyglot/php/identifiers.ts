const PHP_RESERVED_WORDS = new Set<string>([
  'abstract',
  'and',
  'array',
  'as',
  'break',
  'callable',
  'case',
  'catch',
  'class',
  'clone',
  'const',
  'continue',
  'declare',
  'default',
  'die',
  'do',
  'echo',
  'else',
  'elseif',
  'empty',
  'enddeclare',
  'endfor',
  'endforeach',
  'endif',
  'endswitch',
  'endwhile',
  'enum',
  'eval',
  'exit',
  'extends',
  'final',
  'finally',
  'fn',
  'for',
  'foreach',
  'function',
  'global',
  'goto',
  'if',
  'implements',
  'include',
  'include_once',
  'instanceof',
  'insteadof',
  'interface',
  'isset',
  'list',
  'match',
  'namespace',
  'new',
  'or',
  'print',
  'private',
  'protected',
  'public',
  'readonly',
  'require',
  'require_once',
  'return',
  'static',
  'switch',
  'throw',
  'trait',
  'try',
  'unset',
  'use',
  'var',
  'while',
  'xor',
  'yield',
])

/**
 * Convert a schema type name (e.g. `post`, `block_content`) to a PascalCase
 * PHP class identifier.
 */
export function phpClassName(schemaName: string): string {
  return toPascalCase(schemaName)
}

/**
 * Compose a nested-object class name like `Parent_Field` per output-files.md.
 * Both segments are independently PascalCased.
 */
export function phpNestedClassName(parent: string, field: string): string {
  return `${phpClassName(parent)}_${phpClassName(field)}`
}

/**
 * Property rename rule: properties keep their schema field name verbatim
 * (including leading underscores) unless the name collides with a PHP
 * reserved word, in which case we append a single trailing underscore. The
 * original JSON wire key is returned in `jsonKey` so `fromArray` can look it
 * up unchanged.
 */
export function phpPropertyIdentifier(fieldName: string): {
  jsonKey: string
  name: string
  renamed: boolean
} {
  if (PHP_RESERVED_WORDS.has(fieldName.toLowerCase())) {
    return {jsonKey: fieldName, name: `${fieldName}_`, renamed: true}
  }
  return {jsonKey: fieldName, name: fieldName, renamed: false}
}

function toPascalCase(input: string): string {
  if (input.length === 0) return input
  const parts = input.split(/[_\-\s]+/).filter(Boolean)
  return parts
    .map((part) => {
      const first = part.charAt(0).toUpperCase()
      const rest = part.slice(1)
      return first + rest
    })
    .join('')
}
