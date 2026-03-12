import * as t from '@babel/types'

interface TypeDeclaration {
  ast: t.ExportNamedDeclaration
  code: string
  id: t.Identifier
  name: string
  tsType: t.TSType
}

/**
 * Collects all type reference names from a TSType AST node.
 * Walks the AST to find TSTypeReference nodes that reference identifiers.
 */
function collectTypeReferences(node: t.TSType, knownTypes: Set<string>): Set<string> {
  const refs = new Set<string>()

  function walk(n: t.Node): void {
    if (t.isTSTypeReference(n) && t.isIdentifier(n.typeName) && knownTypes.has(n.typeName.name)) {
      refs.add(n.typeName.name)
    }

    // Walk all child nodes
    for (const key of t.VISITOR_KEYS[n.type] ?? []) {
      const child = (n as Record<string, unknown>)[key]
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && 'type' in item) {
            walk(item as t.Node)
          }
        }
      } else if (child && typeof child === 'object' && 'type' in (child as Record<string, unknown>)) {
        walk(child as t.Node)
      }
    }
  }

  walk(node)
  return refs
}

/**
 * Topologically sorts type declarations so that dependencies are defined before
 * the types that reference them. Uses Kahn's algorithm.
 *
 * Handles cycles (common in Sanity schemas, e.g. Post → Author → Post) by
 * preserving the original relative order for types involved in cycles.
 */
export function topologicalSortDeclarations<T extends TypeDeclaration>(declarations: T[]): T[] {
  if (declarations.length <= 1) return declarations

  // Build a set of known type identifier names
  const knownTypeNames = new Set(declarations.map((d) => d.id.name))

  // Build a map from identifier name to declaration
  const declByIdName = new Map<string, T>()
  for (const decl of declarations) {
    declByIdName.set(decl.id.name, decl)
  }

  // Build adjacency list: for each type, which types does it depend on?
  const dependencies = new Map<string, Set<string>>()
  // Reverse: which types depend on this type?
  const dependents = new Map<string, Set<string>>()

  for (const decl of declarations) {
    const refs = collectTypeReferences(decl.tsType, knownTypeNames)
    // Remove self-references
    refs.delete(decl.id.name)
    dependencies.set(decl.id.name, refs)

    for (const ref of refs) {
      if (!dependents.has(ref)) {
        dependents.set(ref, new Set())
      }
      dependents.get(ref)!.add(decl.id.name)
    }
  }

  // Kahn's algorithm: start with types that have no dependencies
  const inDegree = new Map<string, number>()
  for (const decl of declarations) {
    inDegree.set(decl.id.name, dependencies.get(decl.id.name)?.size ?? 0)
  }

  // Use a queue that preserves original order for types with the same in-degree
  const queue: string[] = []
  for (const decl of declarations) {
    if (inDegree.get(decl.id.name) === 0) {
      queue.push(decl.id.name)
    }
  }

  const sorted: T[] = []
  const visited = new Set<string>()

  while (queue.length > 0) {
    const name = queue.shift()!
    if (visited.has(name)) continue
    visited.add(name)

    sorted.push(declByIdName.get(name)!)

    // Reduce in-degree for dependents
    const deps = dependents.get(name) ?? new Set()
    for (const dep of deps) {
      const newDegree = (inDegree.get(dep) ?? 1) - 1
      inDegree.set(dep, newDegree)
      if (newDegree === 0 && !visited.has(dep)) {
        queue.push(dep)
      }
    }
  }

  // Handle cycles: any remaining types not yet visited are in cycles.
  // Add them in their original order.
  if (sorted.length < declarations.length) {
    for (const decl of declarations) {
      if (!visited.has(decl.id.name)) {
        sorted.push(decl)
      }
    }
  }

  return sorted
}
