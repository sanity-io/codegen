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

import {type GenerationStats} from '../index.js'
import {goFieldName, goNestedStructName, goTypeName} from './identifiers.js'
import {emptyUsedShared, renderSharedShapes, type UsedShared} from './shared.js'

/** Sanity wire keys that the embedded Document header already covers. */
const DOCUMENT_HEADER_KEYS = new Set(['_createdAt', '_id', '_rev', '_type', '_updatedAt'])

interface FieldSpec {
  goName: string
  /** Already-rendered Go type (e.g. `string`, `*Reference`, `[]PostBodyBlock`). */
  goType: string
  jsonName: string
  optional: boolean
}

interface StructSpec {
  fields: FieldSpec[]
  /** When set, the struct embeds Document and skips header fields. */
  isDocument: boolean
  name: string
}

interface UnionVariantSpec {
  /** The concrete struct for this variant. */
  structName: string
  /** The wire `_type` literal used for discrimination. */
  typeLiteral: string
}

interface UnionSpec {
  /** Helper name (e.g. `UnmarshalPostBody`). */
  helperName: string
  /** Interface name (e.g. `PostBody`). */
  interfaceName: string
  /** Tag-method name (lowercased, unexported so only generated code implements it). */
  tagMethodName: string
  variants: UnionVariantSpec[]
}

class GoEmitter {
  private documentCount = 0
  private objectCount = 0
  private skipped: GenerationStats['skipped'] = []
  private structs: StructSpec[] = []
  private unions: UnionSpec[] = []
  private used: UsedShared = emptyUsedShared()

  emit(schema: SchemaType): {body: string; stats: GenerationStats; used: UsedShared} {
    for (const decl of schema) {
      if (decl.type === 'document') {
        this.emitDocument(decl)
        this.documentCount += 1
      } else if (decl.type === 'type') {
        this.emitTypeDeclaration(decl)
        this.objectCount += 1
      }
    }

    const pieces: string[] = []
    for (const s of this.structs) {
      pieces.push(renderStruct(s))
    }
    for (const u of this.unions) {
      pieces.push(renderUnion(u))
    }

    return {
      body: pieces.join('\n\n'),
      stats: {documents: this.documentCount, objects: this.objectCount, skipped: this.skipped},
      used: this.used,
    }
  }

  private emitDocument(decl: DocumentSchemaType): void {
    const goName = goTypeName(decl.name, 'document')
    this.used.document = true
    const fields = this.emitObjectFields(goName, decl.attributes, /* isDocument */ true)
    this.structs.push({fields, isDocument: true, name: goName})
  }

  private emitObjectFields(
    structName: string,
    attributes: Record<string, ObjectAttribute>,
    isDocument: boolean,
  ): FieldSpec[] {
    const fields: FieldSpec[] = []
    for (const [wireName, attr] of Object.entries(attributes)) {
      // The embedded Document struct already supplies the header fields.
      if (isDocument && DOCUMENT_HEADER_KEYS.has(wireName)) continue
      const goName = goFieldName(wireName)
      const optional = attr.optional === true
      const goType = this.renderTypeNode(attr.value, structName, wireName)
      const pointered = optional && !isPointerLike(goType) ? `*${goType}` : goType
      fields.push({goName, goType: pointered, jsonName: wireName, optional})
    }
    return fields
  }

  private emitTypeDeclaration(decl: TypeDeclarationSchemaType): void {
    const goName = goTypeName(decl.name, 'type')
    const value = decl.value
    if (value.type === 'object') {
      const fields = this.emitObjectFields(goName, value.attributes, /* isDocument */ false)
      this.structs.push({fields, isDocument: false, name: goName})
    } else {
      // Top-level non-object aliases (e.g. `array`) fall back to UnknownTypeNode
      // semantics; record skip and move on.
      this.skipped.push({
        name: decl.name,
        reason: `top-level non-object type declarations not yet supported in Go (got '${value.type}')`,
      })
    }
  }

  private materializeUnionVariant(
    member: TypeNode,
    interfaceBase: string,
    parentField: string,
  ): UnionVariantSpec | null {
    if (member.type === 'inline') {
      const variantStruct = goTypeName(member.name, 'type')
      const typeLiteral = member.name
      return {structName: variantStruct, typeLiteral}
    }
    if (member.type === 'object') {
      const typeLiteral = extractTypeLiteral(member)
      const variantName = typeLiteral
        ? `${interfaceBase}${pascalShallow(typeLiteral)}`
        : `${interfaceBase}Variant${this.unions.length}`
      const fields = this.emitObjectFields(variantName, member.attributes, /* isDocument */ false)
      this.structs.push({fields, isDocument: false, name: variantName})
      return {
        structName: variantName,
        typeLiteral: typeLiteral ?? variantName,
      }
    }
    this.skipped.push({
      name: parentField,
      reason: `union member of type '${member.type}' is not representable as a Go union variant`,
    })
    return null
  }

  private renderArray(node: ArrayTypeNode, parentStruct: string, parentField: string): string {
    const elementNode = node.of
    if (elementNode.type === 'union') {
      const unionType = this.renderArrayUnion(elementNode, parentStruct, parentField)
      return `[]${unionType}`
    }
    const elementType = this.renderTypeNode(elementNode, parentStruct, parentField)
    return `[]${elementType}`
  }

  private renderArrayUnion(node: UnionTypeNode, parentStruct: string, parentField: string): string {
    const baseName = goNestedStructName(parentStruct, parentField)
    const variants: UnionVariantSpec[] = []
    for (const member of node.of) {
      const variant = this.materializeUnionVariant(member, baseName, parentField)
      if (variant) variants.push(variant)
    }
    if (variants.length === 0) {
      this.skipped.push({
        name: `${parentStruct}.${parentField}`,
        reason: 'union-of-types had no resolvable members; falling back to interface{}',
      })
      return 'interface{}'
    }
    const interfaceName = baseName
    const helperName = `Unmarshal${baseName}`
    const tagMethodName = `sanity${baseName}Type`
    this.unions.push({helperName, interfaceName, tagMethodName, variants})
    return interfaceName
  }

  private renderInlineUnion(
    node: UnionTypeNode,
    parentStruct: string,
    parentField: string,
  ): string {
    // A union outside of an array is treated as `interface{}` in phase 1 — Go has
    // no idiomatic untagged union outside of a slice context. Record the skip.
    this.skipped.push({
      name: `${parentStruct}.${parentField}`,
      reason: 'inline (non-array) union types fall back to interface{} in Go output',
    })
    void node
    return 'interface{}'
  }

  /**
   * Render an object TypeNode. Reference objects (those with a `_ref` attribute) collapse
   * to the inlined `Reference` struct. Other inline objects produce a nested top-level
   * struct named `<Parent><Field>`.
   */
  private renderObjectAsType(
    node: ObjectTypeNode,
    parentStruct: string,
    parentField: string,
  ): string {
    if (isReferenceObject(node)) {
      this.used.reference = true
      return 'Reference'
    }
    if (isSlugObject(node)) {
      this.used.slug = true
      return 'Slug'
    }
    const nestedName = goNestedStructName(parentStruct, parentField)
    const fields = this.emitObjectFields(nestedName, node.attributes, /* isDocument */ false)
    this.structs.push({fields, isDocument: false, name: nestedName})
    return nestedName
  }

  private renderTypeNode(node: TypeNode, parentStruct: string, parentField: string): string {
    switch (node.type) {
      case 'array': {
        return this.renderArray(node, parentStruct, parentField)
      }
      case 'boolean': {
        return 'bool'
      }
      case 'inline': {
        // Reference to a top-level type declaration by name. We trust the orchestrator
        // to emit that declaration as a sibling struct.
        return goTypeName(node.name, 'type')
      }
      case 'null': {
        // Null in JSON maps to a pointer-friendly empty value; choose interface{} so
        // callers can disambiguate. Field's optional flag handles `,omitempty`.
        return 'interface{}'
      }
      case 'number': {
        return 'float64'
      }
      case 'object': {
        return this.renderObjectAsType(node, parentStruct, parentField)
      }
      case 'string': {
        return 'string'
      }
      case 'union': {
        return this.renderInlineUnion(node, parentStruct, parentField)
      }
      case 'unknown': {
        return 'interface{}'
      }
      default: {
        const fallback: never = node
        void fallback
        this.skipped.push({name: parentField, reason: `unsupported type node in Go output`})
        return 'interface{}'
      }
    }
  }
}

function isReferenceObject(node: ObjectTypeNode): boolean {
  const ref = node.attributes._ref
  const type = node.attributes._type
  if (!ref || !type) return false
  if (ref.value.type !== 'string') return false
  if (type.value.type !== 'string') return false
  if (type.value.value !== undefined && type.value.value !== 'reference') return false
  return true
}

function isSlugObject(node: ObjectTypeNode): boolean {
  const type = node.attributes._type
  if (!type || type.value.type !== 'string') return false
  return type.value.value === 'slug'
}

function extractTypeLiteral(node: ObjectTypeNode): string | undefined {
  const type = node.attributes._type
  if (!type || type.value.type !== 'string') return undefined
  return type.value.value
}

function isPointerLike(goType: string): boolean {
  // Slices, maps, interfaces, and existing pointers don't need an extra `*`.
  return goType.startsWith('*') || goType.startsWith('[]') || goType === 'interface{}'
}

function pascalShallow(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function renderStruct(spec: StructSpec): string {
  const lines: string[] = [`type ${spec.name} struct {`]
  if (spec.isDocument) {
    lines.push('\tDocument')
  }
  const rows = spec.fields.map((field) => ({
    name: field.goName,
    tag: `\`${field.optional ? `json:"${field.jsonName},omitempty"` : `json:"${field.jsonName}"`}\``,
    type: field.goType,
  }))
  let nameWidth = 0
  let typeWidth = 0
  for (const r of rows) {
    if (r.name.length > nameWidth) nameWidth = r.name.length
    if (r.type.length > typeWidth) typeWidth = r.type.length
  }
  for (const row of rows) {
    const namePad = ' '.repeat(nameWidth - row.name.length)
    const typePad = ' '.repeat(typeWidth - row.type.length)
    lines.push(`\t${row.name}${namePad} ${row.type}${typePad} ${row.tag}`)
  }
  lines.push('}')
  return lines.join('\n')
}

function renderUnion(spec: UnionSpec): string {
  const lines: string[] = [
    `// ${spec.interfaceName} is one of: ${spec.variants.map((v) => v.structName).join(', ')}.`,
    `type ${spec.interfaceName} interface {`,
    `\t${spec.tagMethodName}() string`,
    '}',
    '',
  ]
  for (const variant of spec.variants) {
    lines.push(
      `func (${variant.structName}) ${spec.tagMethodName}() string { return "${variant.typeLiteral}" }`,
    )
  }
  lines.push(
    '',
    `// ${spec.helperName} decodes a JSON array into the correct ${spec.interfaceName} variants by inspecting each element's "_type".`,
    `func ${spec.helperName}(data []byte) ([]${spec.interfaceName}, error) {`,
    '\tvar raws []json.RawMessage',
    '\tif err := json.Unmarshal(data, &raws); err != nil {',
    '\t\treturn nil, err',
    '\t}',
    `\tout := make([]${spec.interfaceName}, 0, len(raws))`,
    '\tfor i, raw := range raws {',
    '\t\tvar probe struct {',
    '\t\t\tType string `json:"_type"`',
    '\t\t}',
    '\t\tif err := json.Unmarshal(raw, &probe); err != nil {',
    `\t\t\treturn nil, fmt.Errorf("${spec.helperName}: element %d: %w", i, err)`,
    '\t\t}',
    '\t\tswitch probe.Type {',
  )
  for (const variant of spec.variants) {
    lines.push(
      `\t\tcase "${variant.typeLiteral}":`,
      `\t\t\tvar v ${variant.structName}`,
      '\t\t\tif err := json.Unmarshal(raw, &v); err != nil {',
      `\t\t\t\treturn nil, fmt.Errorf("${spec.helperName}: element %d (${variant.typeLiteral}): %w", i, err)`,
      '\t\t\t}',
      '\t\t\tout = append(out, v)',
    )
  }
  lines.push(
    '\t\tdefault:',
    `\t\t\treturn nil, fmt.Errorf("${spec.helperName}: element %d: unknown _type %q", i, probe.Type)`,
    '\t\t}',
    '\t}',
    '\treturn out, nil',
    '}',
  )
  return lines.join('\n')
}

/**
 * Walks the schema once and emits all top-level structs, nested structs, and union
 * helper code. Returns the assembled body string (without the file header, package
 * line, or imports — those are added by `index.ts`), along with stats and which
 * shared shapes the body references.
 */
export function emitGoBody(schema: SchemaType): {
  body: string
  imports: string[]
  stats: GenerationStats
  used: UsedShared
} {
  const emitter = new GoEmitter()
  const {body, stats, used} = emitter.emit(schema)
  const imports = inferImports({body, used})
  const sharedBlock = renderSharedShapes(used)
  const composed = sharedBlock ? `${sharedBlock}\n\n${body}` : body
  return {body: composed, imports, stats, used}
}

function inferImports({body, used}: {body: string; used: UsedShared}): string[] {
  const imports: string[] = []
  // The union-helper code uses encoding/json and fmt; if any union helper is present
  // (i.e. the body contains `json.Unmarshal`), include both.
  if (body.includes('json.Unmarshal')) {
    imports.push('encoding/json', 'fmt')
  }
  void used
  return imports
}
