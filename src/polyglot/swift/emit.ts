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

import {swiftNestedTypeName, swiftPropertyName, swiftTypeName} from './identifiers.js'

interface EmitResult {
  code: string
  stats: {
    documents: number
    objects: number
    skipped: Array<{name: string; reason: string}>
  }
}

interface NestedDecl {
  /** Whether this nested type is `Codable, Sendable`. (Inline objects always are.) */
  fields: string[]
  /** A struct emitted alongside the owning declaration (e.g. inline objects). */
  kind: 'struct'
  name: string
}

interface UnionDecl {
  kind: 'union'
  name: string
  /** Pairs of (Swift case name, variant struct name, discriminator string). */
  variants: Array<{caseName: string; discriminator: string; structName: string}>
}

type AuxDecl = NestedDecl | UnionDecl

function getInlineTypeName(node: TypeNode): string | undefined {
  if (node.type === 'inline') {
    return (node as {name: string}).name
  }
  return undefined
}

/** Skip records used to surface why a path was not emitted. */
function makeSkipped(): Array<{name: string; reason: string}> {
  return []
}

export function emitSwiftCode(schema: SchemaType): EmitResult {
  const skipped = makeSkipped()
  let documents = 0
  let objects = 0

  const lines: string[] = []
  const seenTypeNames = new Set<string>()

  const topLevelByName = new Map<string, DocumentSchemaType | TypeDeclarationSchemaType>()
  for (const entry of schema) {
    topLevelByName.set(entry.name, entry)
  }

  for (const entry of schema) {
    const swiftName = swiftTypeName(entry.name)
    if (seenTypeNames.has(swiftName)) {
      // Defensive: dup names will already have been rejected upstream, but skip
      // duplicate emission to keep deterministic output.
      continue
    }
    seenTypeNames.add(swiftName)

    if (entry.type === 'document') {
      documents += 1
      emitDocument(entry, swiftName, lines, skipped, topLevelByName)
    } else {
      objects += 1
      emitNamedType(entry, swiftName, lines, skipped, topLevelByName)
    }
  }

  return {
    code: lines.join('\n'),
    stats: {documents, objects, skipped},
  }
}

function emitDocument(
  doc: DocumentSchemaType,
  swiftName: string,
  lines: string[],
  skipped: Array<{name: string; reason: string}>,
  topLevelByName: Map<string, DocumentSchemaType | TypeDeclarationSchemaType>,
) {
  const aux: AuxDecl[] = []
  const fieldLines = buildFieldLines(swiftName, doc.attributes, aux, skipped, topLevelByName)

  lines.push(`public struct ${swiftName}: Codable, Sendable, Identifiable {`)
  for (const fl of fieldLines) {
    lines.push(`    ${fl}`)
  }
  lines.push('', `    public var id: String { _id }`, '}', '')

  emitAuxDecls(aux, lines)
}

function emitNamedType(
  decl: TypeDeclarationSchemaType,
  swiftName: string,
  lines: string[],
  skipped: Array<{name: string; reason: string}>,
  topLevelByName: Map<string, DocumentSchemaType | TypeDeclarationSchemaType>,
) {
  const value = decl.value
  if (value.type !== 'object') {
    skipped.push({name: decl.name, reason: `top-level non-object type "${value.type}" not emitted`})
    return
  }
  const aux: AuxDecl[] = []
  const fieldLines = buildFieldLines(swiftName, value.attributes, aux, skipped, topLevelByName)

  lines.push(`public struct ${swiftName}: Codable, Sendable {`)
  for (const fl of fieldLines) {
    lines.push(`    ${fl}`)
  }
  lines.push('}', '')

  emitAuxDecls(aux, lines)
}

function emitAuxDecls(aux: AuxDecl[], lines: string[]) {
  for (const decl of aux) {
    if (decl.kind === 'struct') {
      lines.push(`public struct ${decl.name}: Codable, Sendable {`)
      for (const fl of decl.fields) {
        lines.push(`    ${fl}`)
      }
      lines.push('}', '')
    } else {
      // Union enum with custom Codable.
      lines.push(`public enum ${decl.name}: Codable, Sendable {`)
      for (const v of decl.variants) {
        lines.push(`    case ${v.caseName}(${v.structName})`)
      }
      lines.push(
        '',
        `    private enum DiscriminatorKeys: String, CodingKey { case _type }`,
        '',
        `    public init(from decoder: Decoder) throws {`,
        `        let container = try decoder.container(keyedBy: DiscriminatorKeys.self)`,
        `        let type = try container.decode(String.self, forKey: ._type)`,
        `        switch type {`,
      )
      for (const v of decl.variants) {
        lines.push(
          `        case "${v.discriminator}": self = .${v.caseName}(try ${v.structName}(from: decoder))`,
        )
      }
      lines.push(
        String.raw`        default: throw DecodingError.dataCorruptedError(forKey: ._type, in: container, debugDescription: "Unknown Sanity _type: \(type)")`,
        `        }`,
        `    }`,
        '',
        `    public func encode(to encoder: Encoder) throws {`,
        `        switch self {`,
      )
      for (const v of decl.variants) {
        lines.push(`        case .${v.caseName}(let v): try v.encode(to: encoder)`)
      }
      lines.push(`        }`, `    }`, `}`, '')
    }
  }
}

function buildFieldLines(
  parentTypeName: string,
  attributes: Record<string, ObjectAttribute>,
  aux: AuxDecl[],
  skipped: Array<{name: string; reason: string}>,
  topLevelByName: Map<string, DocumentSchemaType | TypeDeclarationSchemaType>,
): string[] {
  const out: string[] = []
  for (const [fieldName, attr] of Object.entries(attributes)) {
    const swiftType = swiftTypeOf(
      attr.value,
      parentTypeName,
      fieldName,
      aux,
      skipped,
      topLevelByName,
    )
    if (swiftType === undefined) {
      skipped.push({
        name: `${parentTypeName}.${fieldName}`,
        reason: `unsupported type "${attr.value.type}"`,
      })
      continue
    }
    const optional = Boolean(attr.optional)
    const swiftField = swiftPropertyName(fieldName)
    const annotated = optional ? `${swiftType}?` : swiftType
    out.push(`public let ${swiftField}: ${annotated}`)
  }
  return out
}

function swiftTypeOf(
  node: TypeNode,
  parentTypeName: string,
  fieldName: string,
  aux: AuxDecl[],
  skipped: Array<{name: string; reason: string}>,
  topLevelByName: Map<string, DocumentSchemaType | TypeDeclarationSchemaType>,
): string | undefined {
  switch (node.type) {
    case 'array': {
      const arr = node as ArrayTypeNode
      const elem = arr.of
      const elemSwift = swiftArrayElement(
        elem,
        parentTypeName,
        fieldName,
        aux,
        skipped,
        topLevelByName,
      )
      if (elemSwift === undefined) return undefined
      return `[${elemSwift}]`
    }
    case 'boolean': {
      return 'Bool'
    }
    case 'inline': {
      const inlineName = getInlineTypeName(node) ?? ''
      if (!inlineName) return undefined
      return swiftTypeName(inlineName)
    }
    case 'null': {
      return undefined
    }
    case 'number': {
      return 'Double'
    }
    case 'object': {
      const obj = node as ObjectTypeNode
      if (obj.dereferencesTo !== undefined) {
        return 'SanityType.Ref'
      }
      // Inline object — emit a nested struct.
      const nestedName = swiftNestedTypeName(parentTypeName, fieldName)
      const nestedFieldLines = buildFieldLines(
        nestedName,
        obj.attributes,
        aux,
        skipped,
        topLevelByName,
      )
      aux.push({fields: nestedFieldLines, kind: 'struct', name: nestedName})
      return nestedName
    }
    case 'string': {
      return 'String'
    }
    case 'union': {
      // A union at field position outside an array is rare in Sanity schemas;
      // fall back to skipping unless it's the same shape we handle inside arrays.
      const u = node as UnionTypeNode
      const variants = collectUnionVariants(
        u,
        parentTypeName,
        fieldName,
        aux,
        skipped,
        topLevelByName,
      )
      if (variants === undefined) return undefined
      const unionName = swiftNestedTypeName(parentTypeName, fieldName)
      aux.push({kind: 'union', name: unionName, variants})
      return unionName
    }
    case 'unknown': {
      return undefined
    }
    default: {
      return undefined
    }
  }
}

function swiftArrayElement(
  node: TypeNode,
  parentTypeName: string,
  fieldName: string,
  aux: AuxDecl[],
  skipped: Array<{name: string; reason: string}>,
  topLevelByName: Map<string, DocumentSchemaType | TypeDeclarationSchemaType>,
): string | undefined {
  if (node.type === 'union') {
    const u = node as UnionTypeNode
    const variants = collectUnionVariants(
      u,
      parentTypeName,
      fieldName,
      aux,
      skipped,
      topLevelByName,
    )
    if (variants === undefined) return undefined
    const unionName = swiftNestedTypeName(parentTypeName, fieldName)
    aux.push({kind: 'union', name: unionName, variants})
    return unionName
  }
  // Element is a non-union — recurse into the regular emitter, but pass the
  // singular form of the field name as the nesting hint.
  return swiftTypeOf(node, parentTypeName, fieldName, aux, skipped, topLevelByName)
}

function collectUnionVariants(
  union: UnionTypeNode,
  parentTypeName: string,
  fieldName: string,
  aux: AuxDecl[],
  skipped: Array<{name: string; reason: string}>,
  topLevelByName: Map<string, DocumentSchemaType | TypeDeclarationSchemaType>,
): Array<{caseName: string; discriminator: string; structName: string}> | undefined {
  const variants: Array<{caseName: string; discriminator: string; structName: string}> = []
  let inlineIdx = 0
  for (const variant of union.of) {
    if (variant.type === 'inline') {
      const inlineName = (variant as {name: string}).name
      const target = topLevelByName.get(inlineName)
      if (!target) {
        skipped.push({
          name: `${parentTypeName}.${fieldName}`,
          reason: `union variant "${inlineName}" not found in schema`,
        })
        return undefined
      }
      const structName = swiftTypeName(inlineName)
      variants.push({
        caseName: lowerFirst(structName),
        discriminator: inlineName,
        structName,
      })
    } else if (variant.type === 'object') {
      const obj = variant as ObjectTypeNode
      const discriminator = extractDiscriminator(obj)
      if (!discriminator) {
        skipped.push({
          name: `${parentTypeName}.${fieldName}`,
          reason: 'union variant missing _type literal discriminator',
        })
        return undefined
      }
      const structName = swiftNestedTypeName(parentTypeName, discriminator)
      const fields = buildFieldLines(structName, obj.attributes, aux, skipped, topLevelByName)
      aux.push({fields, kind: 'struct', name: structName})
      variants.push({
        caseName: lowerFirst(structName.slice(parentTypeName.length)) || `variant${inlineIdx}`,
        discriminator,
        structName,
      })
      inlineIdx += 1
    } else {
      skipped.push({
        name: `${parentTypeName}.${fieldName}`,
        reason: `union variant of unsupported kind "${variant.type}"`,
      })
      return undefined
    }
  }
  return variants
}

function extractDiscriminator(obj: ObjectTypeNode): string | undefined {
  const typeAttr = obj.attributes?._type
  if (!typeAttr) return undefined
  const value = typeAttr.value
  if (value.type !== 'string') return undefined
  const literal = (value as {value?: string}).value
  return typeof literal === 'string' ? literal : undefined
}

function lowerFirst(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toLowerCase() + s.slice(1)
}
