import fs from 'node:fs'
import path from 'node:path'

import {type TransformOptions, traverse} from '@babel/core'
import {Scope} from '@babel/traverse'
import * as babelTypes from '@babel/types'
import createDebug from 'debug'

import {formatPath} from '../utils/formatPath.js'
import {parseSourceFile} from './parseSource.js'

const debug = createDebug('sanity:codegen:findQueries:debug')

type resolveExpressionReturnType = string

const TAGGED_TEMPLATE_ALLOW_LIST = new Set(['groq'])
const FUNCTION_WRAPPER_ALLOW_LIST = new Set(['defineQuery'])

/**
 * resolveExpression takes a node and returns the resolved value of the expression.
 * @beta
 * @internal
 */
export function resolveExpression({
  babelConfig,
  file,
  filename,
  fnArguments = [],
  node,
  params = [],
  resolver,
  scope,
}: {
  babelConfig: TransformOptions
  file: babelTypes.File
  filename: string
  fnArguments?: babelTypes.Node[]
  node: babelTypes.Node
  params?: babelTypes.Node[]
  resolver: NodeJS.RequireResolve
  scope: Scope
}): resolveExpressionReturnType {
  debug(
    `Resolving node ${node.type} in ${filename}:${node.loc?.start.line}:${node.loc?.start.column}`,
  )
  if (
    babelTypes.isTaggedTemplateExpression(node) &&
    babelTypes.isIdentifier(node.tag) &&
    TAGGED_TEMPLATE_ALLOW_LIST.has(node.tag.name)
  ) {
    return resolveExpression({
      babelConfig,
      file,
      filename,
      fnArguments,
      node: node.quasi,
      params,
      resolver,
      scope,
    })
  }

  if (babelTypes.isTemplateLiteral(node)) {
    const resolvedExpressions = node.expressions.map((expression) =>
      resolveExpression({
        babelConfig,
        file,
        filename,
        fnArguments,
        node: expression,
        params,
        resolver,
        scope,
      }),
    )
    return node.quasis
      .map((quasi, idx) => {
        return (quasi.value.cooked || '') + (resolvedExpressions[idx] || '')
      })
      .join('')
  }

  if (babelTypes.isLiteral(node)) {
    if (node.type === 'NullLiteral' || node.type === 'RegExpLiteral') {
      throw new Error(`Unsupported literal type: ${node.type}`)
    }

    return node.value.toString()
  }

  if (babelTypes.isIdentifier(node)) {
    return resolveIdentifier({
      babelConfig,
      file,
      filename,
      fnArguments,
      node,
      params,
      resolver,
      scope,
    })
  }

  if (babelTypes.isVariableDeclarator(node)) {
    const init = node.init ?? (babelTypes.isAssignmentPattern(node.id) && node.id.right)
    if (!init) {
      throw new Error(`Unsupported variable declarator`)
    }

    return resolveExpression({
      babelConfig,
      file,
      filename,
      fnArguments,
      node: init,
      resolver,
      scope,
    })
  }

  if (
    babelTypes.isCallExpression(node) &&
    babelTypes.isIdentifier(node.callee) &&
    FUNCTION_WRAPPER_ALLOW_LIST.has(node.callee.name)
  ) {
    return resolveExpression({
      babelConfig,
      file,
      filename,
      node: node.arguments[0]!,
      params,
      resolver,
      scope,
    })
  }

  if (babelTypes.isCallExpression(node)) {
    return resolveCallExpression({
      babelConfig,
      file,
      filename,
      fnArguments,
      node,
      params,
      resolver,
      scope,
    })
  }

  if (
    babelTypes.isArrowFunctionExpression(node) ||
    babelTypes.isFunctionDeclaration(node) ||
    babelTypes.isFunctionExpression(node)
  ) {
    const newScope = new Scope(scope.path, scope)

    for (const [i, param] of params.entries()) {
      newScope.push({
        id: param as babelTypes.LVal,
        init: fnArguments[i] as babelTypes.Expression | undefined,
      })
    }

    return resolveExpression({
      babelConfig,
      file,
      filename,
      fnArguments,
      node: node.body,
      params: node.params,
      resolver,
      scope: newScope,
    })
  }

  if (babelTypes.isNewExpression(node)) {
    return resolveExpression({
      babelConfig,
      file,
      filename,
      node: node.callee,
      resolver,
      scope,
    })
  }

  if (babelTypes.isImportDefaultSpecifier(node) || babelTypes.isImportSpecifier(node)) {
    return resolveImportSpecifier({babelConfig, file, filename, fnArguments, node, resolver})
  }

  if (babelTypes.isAssignmentPattern(node)) {
    return resolveExpression({
      babelConfig,
      file,
      filename,
      fnArguments,
      node: node.right,
      params,
      resolver,
      scope,
    })
  }

  // Handle TypeScript type assertions (e.g., `'foo' as string`)
  if (babelTypes.isTSAsExpression(node)) {
    return resolveExpression({
      babelConfig,
      file,
      filename,
      fnArguments,
      node: node.expression,
      params,
      resolver,
      scope,
    })
  }

  if (babelTypes.isMemberExpression(node)) {
    const propertyName = getMemberPropertyName(node)
    const objExpr = resolveToObjectExpression({
      babelConfig,
      file,
      filename,
      node: node.object,
      resolver,
      scope,
    })
    const prop = findObjectProperty(objExpr, propertyName, filename, node)
    return resolveExpression({
      babelConfig,
      file,
      filename,
      fnArguments,
      node: prop.value,
      params,
      resolver,
      scope,
    })
  }

  throw new Error(
    `Unsupported expression type: ${node.type} in ${filename}:${node.loc?.start.line}:${node.loc?.start.column}`,
  )
}

function resolveIdentifier({
  babelConfig,
  file,
  filename,
  fnArguments,
  node,
  params,
  resolver,
  scope,
}: {
  babelConfig: TransformOptions
  file: babelTypes.File
  filename: string
  fnArguments: babelTypes.Node[]
  node: babelTypes.Identifier
  params: babelTypes.Node[]
  resolver: NodeJS.RequireResolve
  scope: Scope
}): resolveExpressionReturnType {
  const paramIndex = params.findIndex(
    (param) =>
      (babelTypes.isIdentifier(param) && node.name === param.name) ||
      (babelTypes.isAssignmentPattern(param) &&
        babelTypes.isIdentifier(param.left) &&
        node.name === param.left.name),
  )
  let argument = fnArguments[paramIndex]
  if (!argument && paramIndex !== -1 && babelTypes.isAssignmentPattern(params[paramIndex])) {
    argument = params[paramIndex].right
  }
  if (argument && babelTypes.isLiteral(argument)) {
    return resolveExpression({
      babelConfig,
      file,
      filename,
      fnArguments,
      node: argument,
      params,
      resolver,
      scope,
    })
  }
  const binding = scope.getBinding(node.name)
  if (binding) {
    if (babelTypes.isIdentifier(binding.path.node)) {
      const isSame = binding.path.node.name === node.name
      if (isSame) {
        throw new Error(
          `Could not resolve same identifier "${node.name}" in "${filename}:${node.loc?.start.line}:${node.loc?.start.column}"`,
        )
      }
    }
    return resolveExpression({
      babelConfig,
      file,
      filename,
      fnArguments,
      node: binding.path.node,
      params,
      resolver,
      scope,
    })
  }

  throw new Error(
    `Could not find binding for node "${node.name}" in ${filename}:${node.loc?.start.line}:${node.loc?.start.column}`,
  )
}

function resolveCallExpression({
  babelConfig,
  file,
  filename,
  node,
  params,
  resolver,
  scope,
}: {
  babelConfig: TransformOptions
  file: babelTypes.File
  filename: string
  fnArguments: babelTypes.Node[]
  node: babelTypes.CallExpression
  params: babelTypes.Node[]
  resolver: NodeJS.RequireResolve
  scope: Scope
}): resolveExpressionReturnType {
  const {callee} = node
  return resolveExpression({
    babelConfig,
    file,
    filename,
    fnArguments: node.arguments,
    node: callee,
    params,
    resolver,
    scope,
  })
}

function resolveImportBinding({
  babelConfig,
  file,
  filename,
  node,
  resolver,
}: {
  babelConfig: TransformOptions
  file: babelTypes.File
  filename: string
  node: babelTypes.ExportSpecifier | babelTypes.ImportDefaultSpecifier | babelTypes.ImportSpecifier
  resolver: NodeJS.RequireResolve
}) {
  let importDeclaration: babelTypes.ImportDeclaration | undefined
  traverse(file, {
    ImportDeclaration(n) {
      if (!babelTypes.isImportDeclaration(n.node)) {
        return
      }
      for (const specifier of n.node.specifiers) {
        if (
          babelTypes.isImportDefaultSpecifier(specifier) &&
          specifier.local.loc?.identifierName === node.local.name
        ) {
          importDeclaration = n.node
          break
        }
        if (specifier.local.name === node.local.name) {
          importDeclaration = n.node
        }
      }
    },
  })

  if (!importDeclaration) {
    throw new Error(`Could not find import declaration for ${node.local.name}`)
  }

  const importName = node.local.name
  const importFileName = importDeclaration.source.value

  const importPath =
    importFileName.startsWith('./') || importFileName.startsWith('../')
      ? path.resolve(path.dirname(filename), importFileName)
      : importFileName

  const resolvedFile = resolver(formatPath(importPath))
  const source = fs.readFileSync(resolvedFile)
  const tree = parseSourceFile(source.toString(), resolvedFile, babelConfig)

  let scope: Scope | undefined
  traverse(tree, {
    Program(p) {
      scope = p.scope
    },
  })
  if (!scope) {
    throw new Error(`Could not find scope for ${filename}`)
  }

  const binding = scope.getBinding(importName)
  return {binding, importFileName, importName, resolvedFile, scope, tree}
}

function resolveImportSpecifier({
  babelConfig,
  file,
  filename,
  fnArguments,
  node,
  resolver,
}: {
  babelConfig: TransformOptions
  file: babelTypes.File
  filename: string
  fnArguments: babelTypes.Node[]
  node: babelTypes.ExportSpecifier | babelTypes.ImportDefaultSpecifier | babelTypes.ImportSpecifier
  resolver: NodeJS.RequireResolve
}): resolveExpressionReturnType {
  const {binding, importFileName, importName, resolvedFile, scope, tree} = resolveImportBinding({
    babelConfig,
    file,
    filename,
    node,
    resolver,
  })

  if (binding) {
    return resolveExpression({
      babelConfig,
      file: tree,
      filename: resolvedFile,
      fnArguments,
      node: binding.path.node,
      resolver,
      scope,
    })
  }

  // It's not a global binding, but it might be a named export
  let namedExport: babelTypes.ExportNamedDeclaration | undefined
  let newImportName: string | undefined
  traverse(tree, {
    ExportDeclaration(p) {
      if (p.node.type === 'ExportNamedDeclaration') {
        for (const specifier of p.node.specifiers) {
          if (
            specifier.type === 'ExportSpecifier' &&
            specifier.exported.type === 'Identifier' &&
            specifier.exported.name === importName
          ) {
            namedExport = p.node
            newImportName = specifier.exported.name
          }
        }
      }
    },
  })

  if (namedExport && newImportName) {
    return resolveExportSpecifier({
      babelConfig,
      filename: resolvedFile,
      fnArguments,
      importName: newImportName,
      node: namedExport,
      resolver,
    })
  }

  let result: resolveExpressionReturnType | undefined
  traverse(tree, {
    ExportDeclaration(p) {
      if (p.node.type === 'ExportAllDeclaration') {
        try {
          result = resolveExportSpecifier({
            babelConfig,
            filename: resolvedFile,
            fnArguments,
            importName,
            node: p.node,
            resolver,
          })
        } catch (e) {
          if ((e as Error).cause !== `noBinding:${importName}`) throw e
        }
      }
    },
  })
  if (result) return result

  throw new Error(`Could not find binding for import "${importName}" in ${importFileName}`)
}

function resolveExportSpecifier({
  babelConfig,
  filename,
  fnArguments,
  importName,
  node,
  resolver,
}: {
  babelConfig: TransformOptions
  filename: string
  fnArguments: babelTypes.Node[]
  importName: string
  node: babelTypes.ExportAllDeclaration | babelTypes.ExportNamedDeclaration
  resolver: NodeJS.RequireResolve
}): resolveExpressionReturnType {
  if (!node.source) {
    throw new Error(`Could not find source for export "${importName}" in ${filename}`)
  }

  const importFileName = node.source.value
  const importPath = path.resolve(path.dirname(filename), importFileName)
  const resolvedFile = resolver(formatPath(importPath))
  const source = fs.readFileSync(resolvedFile)
  const tree = parseSourceFile(source.toString(), resolvedFile, babelConfig)

  let newScope: Scope | undefined
  traverse(tree, {
    Program(p) {
      newScope = p.scope
    },
  })
  if (!newScope) {
    throw new Error(`Could not find scope for ${filename}`)
  }

  const binding = newScope.getBinding(importName)
  if (binding) {
    return resolveExpression({
      babelConfig,
      file: tree,
      filename: resolvedFile,
      fnArguments,
      node: binding.path.node,
      resolver,
      scope: newScope,
    })
  }

  throw new Error(`Could not find binding for export "${importName}" in ${importFileName}`, {
    cause: `noBinding:${importName}`,
  })
}

function getMemberPropertyName(node: babelTypes.MemberExpression): string {
  const {computed, loc, property} = node
  if (!computed && babelTypes.isIdentifier(property)) {
    return property.name
  }
  if (computed && babelTypes.isStringLiteral(property)) {
    return property.value
  }
  const locInfo = loc ? `${loc.filename}:${loc.start.line}:${loc.start.column}` : 'unknown location'
  throw new Error(`Unsupported MemberExpression property type: ${property.type} @ ${locInfo}`)
}

function findObjectProperty(
  objExpr: babelTypes.ObjectExpression,
  propertyName: string,
  filename: string,
  node: babelTypes.Node,
): babelTypes.ObjectProperty {
  for (const prop of objExpr.properties) {
    if (!babelTypes.isObjectProperty(prop)) continue
    if (babelTypes.isIdentifier(prop.key) && prop.key.name === propertyName) {
      return prop
    }
    if (babelTypes.isStringLiteral(prop.key) && prop.key.value === propertyName) {
      return prop
    }
  }
  throw new Error(
    `Could not find property "${propertyName}" in object expression in ${filename}:${node.loc?.start.line}:${node.loc?.start.column}`,
  )
}

function resolveToObjectExpression({
  babelConfig,
  file,
  filename,
  node,
  resolver,
  scope,
}: {
  babelConfig: TransformOptions
  file: babelTypes.File
  filename: string
  node: babelTypes.Node
  resolver: NodeJS.RequireResolve
  scope: Scope
}): babelTypes.ObjectExpression {
  if (babelTypes.isObjectExpression(node)) {
    return node
  }
  if (babelTypes.isTSAsExpression(node)) {
    return resolveToObjectExpression({
      babelConfig,
      file,
      filename,
      node: node.expression,
      resolver,
      scope,
    })
  }
  if (babelTypes.isIdentifier(node)) {
    const binding = scope.getBinding(node.name)
    if (!binding) {
      throw new Error(`Could not find binding for "${node.name}" in ${filename}`)
    }
    return resolveToObjectExpression({
      babelConfig,
      file,
      filename,
      node: binding.path.node,
      resolver,
      scope,
    })
  }
  if (babelTypes.isVariableDeclarator(node)) {
    if (!node.init) {
      throw new Error(`Variable declarator has no init`)
    }
    return resolveToObjectExpression({
      babelConfig,
      file,
      filename,
      node: node.init,
      resolver,
      scope,
    })
  }
  if (babelTypes.isMemberExpression(node)) {
    const propertyName = getMemberPropertyName(node)
    const objExpr = resolveToObjectExpression({
      babelConfig,
      file,
      filename,
      node: node.object,
      resolver,
      scope,
    })
    const prop = findObjectProperty(objExpr, propertyName, filename, node)
    return resolveToObjectExpression({
      babelConfig,
      file,
      filename,
      node: prop.value,
      resolver,
      scope,
    })
  }
  if (babelTypes.isImportDefaultSpecifier(node) || babelTypes.isImportSpecifier(node)) {
    return resolveImportToObjectExpression({babelConfig, file, filename, node, resolver})
  }
  throw new Error(
    `Cannot resolve node type "${node.type}" to ObjectExpression in ${filename}:${node.loc?.start.line}:${node.loc?.start.column}`,
  )
}

function resolveImportToObjectExpression({
  babelConfig,
  file,
  filename,
  node,
  resolver,
}: {
  babelConfig: TransformOptions
  file: babelTypes.File
  filename: string
  node: babelTypes.ImportDefaultSpecifier | babelTypes.ImportSpecifier
  resolver: NodeJS.RequireResolve
}): babelTypes.ObjectExpression {
  const {binding, importFileName, importName, resolvedFile, scope, tree} = resolveImportBinding({
    babelConfig,
    file,
    filename,
    node,
    resolver,
  })

  if (!binding) {
    throw new Error(`Could not find binding for import "${importName}" in ${importFileName}`)
  }

  return resolveToObjectExpression({
    babelConfig,
    file: tree,
    filename: resolvedFile,
    node: binding.path.node,
    resolver,
    scope,
  })
}
