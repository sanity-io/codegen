import * as t from '@babel/types'
import {
  type ArrayTypeNode,
  type DocumentSchemaType,
  type InlineTypeNode,
  type ObjectAttribute,
  type ObjectTypeNode,
  type SchemaType,
  type TypeDeclarationSchemaType,
  typeEvaluate,
  type TypeNode,
  type UnionTypeNode,
} from 'groq-js'

import {safeParseQuery} from '../safeParseQuery.js'
import {ARRAY_OF, INTERNAL_REFERENCE_SYMBOL} from './constants.js'
import {
  getFilterArrayUnionType,
  getUniqueIdentifierForName,
  isIdentifierName,
  weakMapMemo,
} from './helpers.js'
import {type ExtractedQuery, type TypeEvaluationStats} from './types.js'

export class SchemaTypeGenerator {
  public readonly schema: SchemaType
  evaluateQuery = weakMapMemo(
    // eslint-disable-next-line unicorn/consistent-function-scoping
    ({query}: Pick<ExtractedQuery, 'query'>): {stats: TypeEvaluationStats; tsType: t.TSType} => {
      const ast = safeParseQuery(query)
      const typeNode = typeEvaluate(ast, this.schema)
      const tsType = this.generateTsType(typeNode)
      const stats = walkAndCountQueryTypeNodeStats(typeNode)
      return {stats, tsType}
    },
  )
  private arrayOfUsed = false

  private identifiers = new Map<string, t.Identifier>()

  private tsTypes = new Map<string, t.TSType>()

  constructor(schema: SchemaType) {
    this.schema = schema

    const uniqueTypeNames = new Set<string>()
    for (const type of schema) {
      if (uniqueTypeNames.has(type.name)) {
        throw new Error(
          `Duplicate type name "${type.name}" in schema. Type names must be unique within the same schema.`,
        )
      }
      uniqueTypeNames.add(type.name)
    }

    for (const type of schema) {
      const currentIdentifierNames = new Set([...this.identifiers.values()].map((id) => id.name))
      const uniqueIdentifier = getUniqueIdentifierForName(type.name, currentIdentifierNames)
      this.identifiers.set(type.name, uniqueIdentifier)
    }

    for (const type of schema) {
      this.tsTypes.set(type.name, this.generateTsType(type))
    }
  }

  getType(typeName: string): {id: t.Identifier; tsType: t.TSType} | undefined {
    const tsType = this.tsTypes.get(typeName)
    const id = this.identifiers.get(typeName)
    if (tsType && id) return {id, tsType}
    return undefined
  }

  hasType(typeName: string): boolean {
    return this.tsTypes.has(typeName)
  }

  isArrayOfUsed(): boolean {
    return this.arrayOfUsed
  }

  *[Symbol.iterator]() {
    for (const {name} of this.schema) {
      yield {name, ...this.getType(name)!}
    }
  }

  typeNames(): string[] {
    return this.schema.map((schemaType) => schemaType.name)
  }

  /**
   * Helper function used to generate TS types for arrays of inline types, or arrays of inline types
   * wrapped in the ArrayOf wrapper that adds _key prop
   */
  private generateArrayOfTsType(typeNode: ArrayTypeNode): t.TSTypeReference {
    this.arrayOfUsed = true
    const typeNodes = this.generateTsType(typeNode.of)
    return t.tsTypeReference(ARRAY_OF, t.tsTypeParameterInstantiation([typeNodes]))
  }

  // Helper function used to generate TS types for array type nodes.
  private generateArrayTsType(typeNode: ArrayTypeNode): t.TSTypeReference | t.TSUnionType {
    // if it's an array of a single inline type, wrap it in ArrayOf
    if (typeNode.of.type === 'inline') {
      return this.generateArrayOfTsType(typeNode)
    }

    // if it's not an inline object and not a union, wrap in Array
    if (typeNode.of.type !== 'union') {
      const typeNodes = this.generateTsType(typeNode.of)
      return t.tsTypeReference(t.identifier('Array'), t.tsTypeParameterInstantiation([typeNodes]))
    }

    // if it's not a union type or all of the union type members are non-inlines, wrap type in Array
    if (typeNode.of.of.every((unionTypeNode) => unionTypeNode.type !== 'inline')) {
      const typeNodes = this.generateTsType(typeNode.of)
      return t.tsTypeReference(t.identifier('Array'), t.tsTypeParameterInstantiation([typeNodes]))
    }

    // all the union types nodes are inline
    if (typeNode.of.of.every((unionMember) => unionMember.type === 'inline')) {
      return this.generateArrayOfTsType(typeNode)
    }

    // some of the union types are inlines, while some are not - split and recurse
    const arrayOfNonInline = getFilterArrayUnionType(typeNode, (member) => member.type !== 'inline')
    const arrayOfInline = getFilterArrayUnionType(typeNode, (member) => member.type === 'inline')

    return t.tsUnionType([
      this.generateArrayTsType(arrayOfNonInline),
      this.generateArrayTsType(arrayOfInline),
    ])
  }

  // Helper function used to generate TS types for document type nodes.
  private generateDocumentTsType(document: DocumentSchemaType): t.TSType {
    const props = Object.entries(document.attributes).map(([key, node]) =>
      this.generateTsObjectProperty(key, node),
    )

    return t.tsTypeLiteral(props)
  }

  private generateInlineTsType(typeNode: InlineTypeNode): t.TSType {
    const id = this.identifiers.get(typeNode.name)
    if (!id) {
      // Not found in schema, return unknown type
      return t.addComment(
        t.tsUnknownKeyword(),
        'trailing',
        ` Unable to locate the referenced type "${typeNode.name}" in schema`,
        true,
      )
    }

    return t.tsTypeReference(id)
  }

  // Helper function used to generate TS types for object type nodes.
  private generateObjectTsType(typeNode: ObjectTypeNode): t.TSType {
    const props: t.TSPropertySignature[] = []
    for (const [key, attribute] of Object.entries(typeNode.attributes)) {
      props.push(this.generateTsObjectProperty(key, attribute))
    }
    const rest = typeNode.rest

    if (rest) {
      switch (rest.type) {
        case 'inline': {
          const resolved = this.generateInlineTsType(rest)
          // if object rest is unknown, we can't generate a type literal for it
          if (t.isTSUnknownKeyword(resolved)) return resolved
          return t.tsIntersectionType([t.tsTypeLiteral(props), resolved])
        }
        case 'object': {
          for (const [key, attribute] of Object.entries(rest.attributes)) {
            props.push(this.generateTsObjectProperty(key, attribute))
          }
          break
        }
        case 'unknown': {
          return t.tsUnknownKeyword()
        }
        default: {
          // @ts-expect-error This should never happen
          throw new Error(`Type "${rest.type}" not found in schema`)
        }
      }
    }

    if (typeNode.dereferencesTo) {
      const derefType = Object.assign(
        t.tsPropertySignature(
          INTERNAL_REFERENCE_SYMBOL,
          t.tsTypeAnnotation(t.tsLiteralType(t.stringLiteral(typeNode.dereferencesTo))),
        ),
        {computed: true, optional: true},
      )
      props.push(derefType)
    }

    return t.tsTypeLiteral(props)
  }

  // Helper function used to generate TS types for object properties.
  private generateTsObjectProperty(key: string, attribute: ObjectAttribute): t.TSPropertySignature {
    const type = this.generateTsType(attribute.value)
    const keyNode = isIdentifierName(key) ? t.identifier(key) : t.stringLiteral(key)
    const propertySignature = t.tsPropertySignature(keyNode, t.tsTypeAnnotation(type))
    propertySignature.optional = attribute.optional

    return propertySignature
  }

  private generateTsType(
    typeNode: DocumentSchemaType | TypeDeclarationSchemaType | TypeNode,
  ): t.TSType {
    switch (typeNode.type) {
      case 'array': {
        return this.generateArrayTsType(typeNode)
      }
      case 'boolean': {
        if (typeNode.value !== undefined) {
          return t.tsLiteralType(t.booleanLiteral(typeNode.value))
        }
        return t.tsBooleanKeyword()
      }
      case 'document': {
        return this.generateDocumentTsType(typeNode)
      }
      case 'inline': {
        return this.generateInlineTsType(typeNode)
      }
      case 'null': {
        return t.tsNullKeyword()
      }
      case 'number': {
        if (typeNode.value !== undefined) {
          return t.tsLiteralType(t.numericLiteral(typeNode.value))
        }
        return t.tsNumberKeyword()
      }
      case 'object': {
        return this.generateObjectTsType(typeNode)
      }
      case 'string': {
        if (typeNode.value !== undefined) {
          return t.tsLiteralType(t.stringLiteral(typeNode.value))
        }
        return t.tsStringKeyword()
      }
      case 'type': {
        return this.generateTsType(typeNode.value)
      }
      case 'union': {
        return this.generateUnionTsType(typeNode)
      }
      case 'unknown': {
        return t.tsUnknownKeyword()
      }

      default: {
        throw new Error(
          `Encountered unsupported node type "${
            // @ts-expect-error This should never happen
            typeNode.type
          }" while generating schema types`,
        )
      }
    }
  }

  // Helper function used to generate TS types for union type nodes.
  private generateUnionTsType(typeNode: UnionTypeNode): t.TSType {
    if (typeNode.of.length === 0) return t.tsNeverKeyword()
    if (typeNode.of.length === 1) return this.generateTsType(typeNode.of[0]!)
    return t.tsUnionType(typeNode.of.map((node) => this.generateTsType(node)))
  }
}

export function walkAndCountQueryTypeNodeStats(typeNode: TypeNode): TypeEvaluationStats {
  switch (typeNode.type) {
    case 'array': {
      const acc = walkAndCountQueryTypeNodeStats(typeNode.of)
      acc.allTypes += 1 // count the array type itself
      return acc
    }
    case 'object': {
      // if the rest is unknown, we count it as one unknown type
      if (typeNode.rest && typeNode.rest.type === 'unknown') {
        return {allTypes: 2, emptyUnions: 0, unknownTypes: 1} // count the object type itself as well
      }

      const restStats = typeNode.rest
        ? walkAndCountQueryTypeNodeStats(typeNode.rest)
        : {allTypes: 0, emptyUnions: 0, unknownTypes: 0}

      // count the object type itself
      restStats.allTypes += 1

      const attrs = Object.values(typeNode.attributes)
      let acc = restStats
      for (const attribute of attrs) {
        const {allTypes, emptyUnions, unknownTypes} = walkAndCountQueryTypeNodeStats(
          attribute.value,
        )
        acc = {
          allTypes: acc.allTypes + allTypes,
          emptyUnions: acc.emptyUnions + emptyUnions,
          unknownTypes: acc.unknownTypes + unknownTypes,
        }
      }
      return acc
    }
    case 'union': {
      if (typeNode.of.length === 0) {
        return {allTypes: 1, emptyUnions: 1, unknownTypes: 0}
      }

      let acc = {allTypes: 1, emptyUnions: 0, unknownTypes: 0} // count the union type itself
      for (const type of typeNode.of) {
        const {allTypes, emptyUnions, unknownTypes} = walkAndCountQueryTypeNodeStats(type)
        acc = {
          allTypes: acc.allTypes + allTypes,
          emptyUnions: acc.emptyUnions + emptyUnions,
          unknownTypes: acc.unknownTypes + unknownTypes,
        }
      }
      return acc
    }
    case 'unknown': {
      return {allTypes: 1, emptyUnions: 0, unknownTypes: 1}
    }
    default: {
      return {allTypes: 1, emptyUnions: 0, unknownTypes: 0}
    }
  }
}
