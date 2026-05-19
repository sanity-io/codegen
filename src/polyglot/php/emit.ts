import {
  type ArrayTypeNode,
  type DocumentSchemaType,
  type ObjectAttribute,
  type ObjectTypeNode,
  type SchemaType,
  type TypeDeclarationSchemaType,
  type TypeNode,
  type UnionTypeNode,
} from 'groq-js'

import {phpClassName, phpNestedClassName, phpPropertyIdentifier} from './identifiers.js'
import {emitSharedShapes, type UsedSharedShapes} from './shared.js'

/**
 * The header attributes that every Sanity document carries. These are emitted
 * by the inlined `Document` base class; per-document classes pass them
 * through to `parent::__construct`.
 */
const DOCUMENT_HEADER_FIELDS = new Set(['_createdAt', '_id', '_rev', '_type', '_updatedAt'])

interface EmittedField {
  /** Type used by the fromArray factory to hydrate this field. */
  hydration: FieldHydration
  /** Raw schema field name used as the JSON key. */
  jsonKey: string
  /** True if the field is optional in the schema. */
  optional: boolean
  /** PHP property name (may be renamed). */
  phpName: string
  /** PHP type string (e.g. `string`, `?Reference`, `?array`). */
  phpType: string

  /** Optional `@var` annotation for typed array PHPDoc. */
  arrayElementType?: string
}

type FieldHydration =
  | {className: string; kind: 'array-of-class'}
  | {className: string; kind: 'class'}
  | {kind: 'array-of-scalar'}
  | {kind: 'array-of-union'; variants: Array<{className: string; tag: string}>}
  | {kind: 'passthrough'}

interface EmittedClass {
  fields: EmittedField[]
  isDocument: boolean
  name: string
}

export interface EmitArgs {
  namespace: string
  reservedClasses: ReadonlyArray<string>
  schema: SchemaType
}

export interface EmitResult {
  body: string
  documentCount: number
  objectCount: number
  skipped: Array<{name: string; reason: string}>
}

interface EmitState {
  /** Inline-object classes discovered during the walk, emitted after the
   * top-level pass so their parents reference them by name. */
  inlineClasses: EmittedClass[]
  skipped: Array<{name: string; reason: string}>
  /** Union-array variant wrappers (e.g. inline objects inside `union.of[]`)
   * appended alongside `inlineClasses` so emission order is stable. */
  used: UsedSharedShapes
}

export function emit(args: EmitArgs): EmitResult {
  const {namespace, reservedClasses, schema} = args
  const reservedSet = new Set(reservedClasses)
  const state: EmitState = {
    inlineClasses: [],
    skipped: [],
    used: {asset: false, document: false, image: false, reference: false, slug: false},
  }

  // First pass: enforce sanity-php namespace collision (R11) before any emit work.
  for (const entry of schema) {
    const className = phpClassName(entry.name)
    const fqn = `${namespace}\\${className}`
    if (reservedSet.has(fqn)) {
      throw new Error(
        `php generator: class '${fqn}' collides with sanity-io/sanity-php. ` +
          String.raw`Set typegen.php.namespace to a non-conflicting value (e.g. 'App\\Sanity\\Generated').`,
      )
    }
  }

  const topLevelClasses: EmittedClass[] = []
  let documentCount = 0
  let objectCount = 0

  for (const entry of schema) {
    if (entry.type === 'document') {
      topLevelClasses.push(emitDocument(entry, state))
      documentCount++
    } else {
      const objClass = emitNamedType(entry, state)
      if (objClass) {
        topLevelClasses.push(objClass)
        objectCount++
      }
    }
  }

  const classBlocks: string[] = []

  const sharedBlock = emitSharedShapes(state.used)
  if (sharedBlock.length > 0) {
    classBlocks.push(sharedBlock)
  }

  for (const cls of topLevelClasses) {
    classBlocks.push(renderClass(cls))
  }

  for (const cls of state.inlineClasses) {
    classBlocks.push(renderClass(cls))
  }

  return {
    body: classBlocks.join('\n\n'),
    documentCount,
    objectCount,
    skipped: state.skipped,
  }
}

function emitDocument(doc: DocumentSchemaType, state: EmitState): EmittedClass {
  state.used.document = true
  const fields: EmittedField[] = []
  for (const [fieldName, attr] of Object.entries(doc.attributes)) {
    if (DOCUMENT_HEADER_FIELDS.has(fieldName)) continue
    const field = emitField(doc.name, fieldName, attr, state)
    if (field) fields.push(field)
  }
  return {fields, isDocument: true, name: phpClassName(doc.name)}
}

function emitNamedType(
  decl: TypeDeclarationSchemaType,
  state: EmitState,
): EmittedClass | undefined {
  if (decl.value.type !== 'object') {
    state.skipped.push({
      name: decl.name,
      reason: `top-level named type with non-object value (${decl.value.type}) is not representable as a PHP class`,
    })
    return undefined
  }
  const fields: EmittedField[] = []
  for (const [fieldName, attr] of Object.entries(decl.value.attributes)) {
    // For named non-document types, `_type` is part of the wire shape but is
    // not a header — emit it as a regular property so consumers see the tag.
    const field = emitField(decl.name, fieldName, attr, state)
    if (field) fields.push(field)
  }
  return {fields, isDocument: false, name: phpClassName(decl.name)}
}

function emitField(
  parentName: string,
  fieldName: string,
  attr: ObjectAttribute,
  state: EmitState,
): EmittedField | undefined {
  const ident = phpPropertyIdentifier(fieldName)
  const optional = attr.optional === true
  const mapped = mapTypeNode(attr.value, parentName, fieldName, state)
  if (!mapped) {
    state.skipped.push({
      name: `${parentName}.${fieldName}`,
      reason: 'unsupported type node',
    })
    return undefined
  }

  return {
    arrayElementType: mapped.arrayElementType,
    hydration: mapped.hydration,
    jsonKey: ident.jsonKey,
    optional,
    phpName: ident.name,
    phpType: optional ? `?${mapped.phpType}` : mapped.phpType,
  }
}

interface MappedType {
  hydration: FieldHydration
  phpType: string

  arrayElementType?: string
}

function mapTypeNode(
  node: TypeNode,
  parentName: string,
  fieldName: string,
  state: EmitState,
): MappedType | undefined {
  switch (node.type) {
    case 'array': {
      return mapArrayField(node, parentName, fieldName, state)
    }
    case 'boolean': {
      return {hydration: {kind: 'passthrough'}, phpType: 'bool'}
    }
    case 'inline': {
      return {
        hydration: {className: phpClassName(node.name), kind: 'class'},
        phpType: phpClassName(node.name),
      }
    }
    case 'number': {
      return {hydration: {kind: 'passthrough'}, phpType: 'float'}
    }
    case 'object': {
      return mapObjectField(node, parentName, fieldName, state)
    }
    case 'string': {
      return {hydration: {kind: 'passthrough'}, phpType: 'string'}
    }
    case 'union': {
      // A bare union (not inside an array) is unusual for Sanity object fields.
      // Fall through to mixed with a skipped entry so the run still succeeds.
      state.skipped.push({
        name: `${parentName}.${fieldName}`,
        reason: 'bare union-of-types field; only union-in-array is fully discriminated in phase 1',
      })
      return {hydration: {kind: 'passthrough'}, phpType: 'mixed'}
    }
    default: {
      // `null` and `unknown` flow through here.
      return {hydration: {kind: 'passthrough'}, phpType: 'mixed'}
    }
  }
}

function mapObjectField(
  node: ObjectTypeNode,
  parentName: string,
  fieldName: string,
  state: EmitState,
): MappedType | undefined {
  // Special shape: { _ref, _type, ... } is a Sanity reference.
  if (isReferenceShape(node)) {
    state.used.reference = true
    return {hydration: {className: 'Reference', kind: 'class'}, phpType: 'Reference'}
  }
  // Special shape: { current, _type: 'slug' } is a slug.
  if (isSlugShape(node)) {
    state.used.slug = true
    return {hydration: {className: 'Slug', kind: 'class'}, phpType: 'Slug'}
  }

  // Inline object → nested class named `Parent_Field`.
  const nestedName = phpNestedClassName(parentName, fieldName)
  const fields: EmittedField[] = []
  for (const [innerName, innerAttr] of Object.entries(node.attributes)) {
    const field = emitField(nestedName, innerName, innerAttr, state)
    if (field) fields.push(field)
  }
  state.inlineClasses.push({fields, isDocument: false, name: nestedName})

  return {hydration: {className: nestedName, kind: 'class'}, phpType: nestedName}
}

function mapArrayField(
  node: ArrayTypeNode,
  parentName: string,
  fieldName: string,
  state: EmitState,
): MappedType | undefined {
  const elem = node.of

  if (elem.type === 'union') {
    return mapUnionArrayField(elem, parentName, fieldName, state)
  }

  const mappedElem = mapTypeNode(elem, parentName, `${fieldName}Item`, state)
  if (!mappedElem) return undefined

  if (mappedElem.hydration.kind === 'class') {
    return {
      arrayElementType: mappedElem.phpType,
      hydration: {className: mappedElem.hydration.className, kind: 'array-of-class'},
      phpType: 'array',
    }
  }

  return {
    arrayElementType: mappedElem.phpType,
    hydration: {kind: 'array-of-scalar'},
    phpType: 'array',
  }
}

function mapUnionArrayField(
  union: UnionTypeNode,
  parentName: string,
  fieldName: string,
  state: EmitState,
): MappedType {
  const variants: Array<{className: string; tag: string}> = []
  for (const variant of union.of) {
    if (variant.type === 'inline') {
      // The wire tag is the unmodified schema type name; the class name is its
      // PascalCase form.
      variants.push({className: phpClassName(variant.name), tag: variant.name})
      continue
    }
    if (variant.type === 'object') {
      // Synthesize an inline class for the anonymous variant.
      const tag = readObjectTypeTag(variant)
      const className = tag
        ? phpNestedClassName(parentName, `${fieldName}_${tag}`)
        : phpNestedClassName(parentName, `${fieldName}Variant${variants.length}`)
      const fields: EmittedField[] = []
      for (const [innerName, innerAttr] of Object.entries(variant.attributes)) {
        const field = emitField(className, innerName, innerAttr, state)
        if (field) fields.push(field)
      }
      state.inlineClasses.push({fields, isDocument: false, name: className})
      variants.push({className, tag: tag ?? className})
      continue
    }
    state.skipped.push({
      name: `${parentName}.${fieldName}`,
      reason: `union variant of type '${variant.type}' is not representable as a PHP class`,
    })
  }

  const elementUnion = variants.map((v) => v.className).join('|')

  return {
    arrayElementType: elementUnion.length > 0 ? elementUnion : 'mixed',
    hydration: {kind: 'array-of-union', variants},
    phpType: 'array',
  }
}

function isReferenceShape(node: ObjectTypeNode): boolean {
  const refAttr = node.attributes._ref
  const typeAttr = node.attributes._type
  if (!refAttr || !typeAttr) return false
  if (refAttr.value.type !== 'string' || typeAttr.value.type !== 'string') return false
  return typeAttr.value.value === 'reference'
}

function isSlugShape(node: ObjectTypeNode): boolean {
  const cur = node.attributes.current
  const typeAttr = node.attributes._type
  if (!cur || !typeAttr) return false
  if (cur.value.type !== 'string' || typeAttr.value.type !== 'string') return false
  return typeAttr.value.value === 'slug'
}

function readObjectTypeTag(node: ObjectTypeNode): string | undefined {
  const typeAttr = node.attributes._type
  if (!typeAttr || typeAttr.value.type !== 'string') return undefined
  return typeAttr.value.value
}

function renderClass(cls: EmittedClass): string {
  const finalKeyword = 'final'
  const header = cls.isDocument
    ? `${finalKeyword} readonly class ${cls.name} extends Document {`
    : `${finalKeyword} readonly class ${cls.name} {`

  const lines: string[] = [header, renderConstructor(cls), '', renderFromArray(cls), '}']
  return lines.join('\n')
}

function renderConstructor(cls: EmittedClass): string {
  const indent = '    '
  const paramIndent = '        '
  const params: string[] = []

  if (cls.isDocument) {
    // Document header fields are passed through to parent::__construct;
    // they are unpromoted parameters here. `_rev`/`_createdAt`/`_updatedAt`
    // are required here (no default) so we can keep schema-order optional
    // fields after them without PHP 8.5's deprecation for optional-before-
    // required parameters.
    params.push(
      `${paramIndent}string $_id,`,
      `${paramIndent}string $_type,`,
      `${paramIndent}?string $_rev,`,
      `${paramIndent}?string $_createdAt,`,
      `${paramIndent}?string $_updatedAt,`,
    )
  }

  // PHP 8.5 deprecates optional parameters declared before required ones.
  // Emit all required (non-optional) fields first, then optional fields,
  // preserving schema-declaration order within each group.
  const required = cls.fields.filter((f) => !f.optional)
  const optional = cls.fields.filter((f) => f.optional)
  for (const f of [...required, ...optional]) {
    const phpDoc = f.arrayElementType
      ? `${paramIndent}/** @var ${f.arrayElementType}[]|null */\n`
      : ''
    const defaultClause = f.optional ? ' = null' : ''
    params.push(`${phpDoc}${paramIndent}public ${f.phpType} $${f.phpName}${defaultClause},`)
  }

  const ctorOpen = `${indent}public function __construct(`
  const ctorClose = `${indent}) {`
  const body: string[] = [ctorOpen, ...params, ctorClose]

  if (cls.isDocument) {
    body.push(`${paramIndent}parent::__construct($_id, $_type, $_rev, $_createdAt, $_updatedAt);`)
  }

  body.push(`${indent}}`)
  return body.join('\n')
}

function renderFromArray(cls: EmittedClass): string {
  const indent = '    '
  const innerIndent = '        '
  const argIndent = '            '
  const lines: string[] = [
    `${indent}public static function fromArray(array $data): self {`,
    `${innerIndent}return new self(`,
  ]

  if (cls.isDocument) {
    lines.push(
      `${argIndent}_id: $data['_id'],`,
      `${argIndent}_type: $data['_type'],`,
      `${argIndent}_rev: $data['_rev'] ?? null,`,
      `${argIndent}_createdAt: $data['_createdAt'] ?? null,`,
      `${argIndent}_updatedAt: $data['_updatedAt'] ?? null,`,
    )
  }

  for (const f of cls.fields) {
    lines.push(`${argIndent}${f.phpName}: ${renderHydration(f)},`)
  }

  lines.push(`${innerIndent});`, `${indent}}`)
  return lines.join('\n')
}

function renderHydration(f: EmittedField): string {
  const key = `$data['${f.jsonKey}']`
  switch (f.hydration.kind) {
    case 'array-of-class': {
      const cn = f.hydration.className
      return `isset(${key}) ? array_map(fn(array $item): ${cn} => ${cn}::fromArray($item), ${key}) : null`
    }
    case 'array-of-scalar': {
      return `${key} ?? null`
    }
    case 'array-of-union': {
      const arms = f.hydration.variants
        .map((v) => `'${escapeSingleQuote(v.tag)}' => ${v.className}::fromArray($item)`)
        .join(', ')
      const arms2 = arms.length > 0 ? arms + ', ' : ''
      return (
        `isset(${key}) ? array_map(` +
        `fn(array $item) => match ($item['_type'] ?? null) { ${arms2}default => $item }, ${key}` +
        `) : null`
      )
    }
    case 'class': {
      return `isset(${key}) ? ${f.hydration.className}::fromArray(${key}) : null`
    }
    case 'passthrough': {
      return `${key} ?? null`
    }
    default: {
      return `${key} ?? null`
    }
  }
}

function escapeSingleQuote(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", String.raw`\'`)
}
