import * as t from '@babel/types'
import {hashTypeNode, type ObjectTypeNode, type TypeNode} from 'groq-js'

import {singularize} from '../utils/singularize.js'
import {getUniqueIdentifierForName} from './helpers.js'

/**
 * Walks all TypeNodes recursively, fingerprints every object node, and counts occurrences.
 * Returns a map from fingerprint to count + the representative TypeNode + candidate name.
 */
export function collectObjectFingerprints(
  typeNodes: TypeNode[],
): Map<string, {candidateName: string | null; count: number; typeNode: ObjectTypeNode}> {
  const result = new Map<
    string,
    {candidateName: string | null; count: number; typeNode: ObjectTypeNode}
  >()

  for (const typeNode of typeNodes) {
    walkTypeNode(typeNode, result)
  }
  return result
}

function walkTypeNode(
  typeNode: TypeNode,
  result: Map<string, {candidateName: string | null; count: number; typeNode: ObjectTypeNode}>,
  parentKey?: string,
): void {
  switch (typeNode.type) {
    case 'array': {
      walkTypeNode(typeNode.of, result, parentKey ? singularize(parentKey) : undefined)
      break
    }
    case 'object': {
      const fp = hashTypeNode(typeNode)
      const existing = result.get(fp)
      if (existing) {
        existing.count++
      } else {
        result.set(fp, {
          candidateName: extractCandidateName(typeNode, parentKey),
          count: 1,
          typeNode,
        })
      }
      // Walk into attributes
      for (const [key, attr] of Object.entries(typeNode.attributes)) {
        walkTypeNode(attr.value, result, key)
      }
      // Walk into rest if it's an object
      if (typeNode.rest) {
        walkTypeNode(typeNode.rest, result)
      }
      break
    }
    case 'union': {
      for (const member of typeNode.of) {
        walkTypeNode(member, result, parentKey)
      }
      break
    }
    default: {
      // Primitives and inline types have no nested objects
      break
    }
  }
}

function inlinePrefix(candidateName: string | null): string {
  if (!candidateName) return 'InlineType'
  return `Inline${candidateName.charAt(0).toUpperCase()}${candidateName.slice(1)}`
}

function extractCandidateName(typeNode: ObjectTypeNode, parentKey?: string): string | null {
  const typeAttr = typeNode.attributes._type
  if (
    typeAttr &&
    !typeAttr.optional &&
    typeAttr.value.type === 'string' &&
    typeAttr.value.value !== undefined
  ) {
    return typeAttr.value.value
  }
  return parentKey ?? null
}

const STRUCTURAL_KEYS = new Set(['_key', '_ref', '_type'])

/**
 * Returns true if an object type has enough meaningful attributes to
 * justify extracting it into a named type alias.
 */
function isWorthExtracting(typeNode: ObjectTypeNode): boolean {
  let meaningful = 0
  for (const key of Object.keys(typeNode.attributes)) {
    if (!STRUCTURAL_KEYS.has(key)) meaningful++
  }
  return meaningful >= 2
}

export interface DeduplicationRegistry {
  extractedTypes: Map<string, {id: t.Identifier; typeNode: ObjectTypeNode}>
}

/**
 * Filters to objects appearing 2+ times, generates unique identifiers.
 */
export function buildDeduplicationRegistry(
  fingerprints: Map<
    string,
    {candidateName: string | null; count: number; typeNode: ObjectTypeNode}
  >,
  existingIdentifiers: Set<string>,
): DeduplicationRegistry {
  const extractedTypes = new Map<string, {id: t.Identifier; typeNode: ObjectTypeNode}>()
  const currentIdentifiers = new Set(existingIdentifiers)

  for (const [fp, {candidateName, count, typeNode}] of fingerprints) {
    if (count < 2) continue
    if (!isWorthExtracting(typeNode)) continue

    const baseName = inlinePrefix(candidateName)
    const id = getUniqueIdentifierForName(baseName, currentIdentifiers)
    currentIdentifiers.add(id.name)

    extractedTypes.set(fp, {id, typeNode})
  }

  return {extractedTypes}
}
