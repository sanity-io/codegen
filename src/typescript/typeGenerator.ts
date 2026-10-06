/* eslint-disable unicorn/consistent-function-scoping */
import process from 'node:process'

import * as t from '@babel/types'
import {type WorkerChannel, type WorkerChannelReporter} from '@sanity/worker-channels'
import {type SchemaType} from 'groq-js'
import {createSelector} from 'reselect'

import {resultSuffix} from '../casing.js'
import {
  ALL_SANITY_SCHEMA_TYPES,
  ARRAY_OF,
  INTERNAL_REFERENCE_SYMBOL,
  SANITY_PROJECTIONS_BY_RESOURCE,
  SANITY_QUERIES,
  SANITY_QUERIES_BY_RESOURCE,
  SANITY_SCHEMAS_BY_RESOURCE,
} from './constants.js'
import {
  computeOnce,
  generateCode,
  getUniqueIdentifierForName,
  normalizePrintablePath,
  tsDeclareGlobal,
  tsDeclareModule,
} from './helpers.js'
import {SchemaTypeGenerator} from './schemaTypeGenerator.js'
import {
  type EvaluatedModule,
  type EvaluatedProjection,
  type EvaluatedQuery,
  type ExtractedModule,
  type ExtractedProjection,
  QueryEvaluationError,
  type QueryExtractionError,
} from './types.js'

/** @public */
export type TypegenWorkerChannel = WorkerChannel.Definition<{
  evaluatedModules: WorkerChannel.Stream<EvaluatedModule>
  generatedQueryTypes: WorkerChannel.Event<{
    queryMapDeclaration: {ast: t.Program; code: string}
  }>
  generatedSchemaTypes: WorkerChannel.Event<{
    allSanitySchemaTypesDeclaration: {
      ast: t.ExportNamedDeclaration
      code: string
      id: t.Identifier
    }
    internalReferenceSymbol: {
      ast: t.ExportNamedDeclaration
      code: string
      id: t.Identifier
    }
    schemaTypeDeclarations: {
      ast: t.ExportNamedDeclaration
      code: string
      id: t.Identifier
      name: string
      tsType: t.TSType
    }[]
  }>
}>

/**
 * The project and dataset a schema belongs to.
 * @beta
 */
export interface TypegenResource {
  dataset: string
  projectId: string
}

/** @public */
export interface GenerateTypesOptions {
  schema: SchemaType

  /**
   * Generate the client's flat `SanityQueries` map, which types `client.fetch`. Independent of
   * `resource`. When an app generates types for more than one resource into one TypeScript
   * program, set this to `false` for all of them: each file would declare the same query text
   * in the flat map with a different type, and TypeScript rejects that merge.
   */
  overloadClientMethods?: boolean
  queries?: AsyncIterable<ExtractedModule>
  reporter?: WorkerChannelReporter<TypegenWorkerChannel>
  /**
   * Also register the schema and query result types under this project and dataset, so one
   * app can read more than one dataset and resolve the same query text to a different type for
   * each. Types go into the global `SanitySchemasByResource` and `SanityQueriesByResource`
   * interfaces that `@sanity/client` 8.7.0 and later declare, keyed `projectId.dataset`, the
   * same string the App SDK uses for its runtime cache.
   *
   * The registration is a plain global declaration and never resolves `@sanity/client`, so it
   * works when the client is only a dependency of another package, as with the App SDK under
   * pnpm. The flat map's bridge does resolve it, so in that layout also set
   * `overloadClientMethods: false`. Generate one file per resource per TypeScript program: two
   * files registering the same resource conflict.
   * @beta
   */
  resource?: TypegenResource
  root?: string
  schemaPath?: string
}

type GetEvaluatedModulesOptions = GenerateTypesOptions & {
  schemaTypeDeclarations: ReturnType<TypeGenerator['getSchemaTypeDeclarations']>
  schemaTypeGenerator: SchemaTypeGenerator
}
type GetQueryMapDeclarationOptions = GenerateTypesOptions & {
  evaluatedModules: EvaluatedModule[]
}

/**
 * A class used to generate TypeScript types from a given schema
 * @beta
 */
export class TypeGenerator {
  private getSchemaTypeGenerator = createSelector(
    [(options: GenerateTypesOptions) => options.schema],

    (schema) => new SchemaTypeGenerator(schema),
  )

  private getSchemaTypeDeclarations = createSelector(
    [
      (options: GenerateTypesOptions) => options.root,
      (options: GenerateTypesOptions) => options.schemaPath,
      this.getSchemaTypeGenerator,
    ],

    (root = process.cwd(), schemaPath, schema) =>
      [...schema].map(({id, name, tsType}, index) => {
        const typeAlias = t.tsTypeAliasDeclaration(id, null, tsType)
        let ast = t.exportNamedDeclaration(typeAlias)

        if (index === 0 && schemaPath) {
          ast = t.addComments(ast, 'leading', [
            {type: 'CommentLine', value: ` Source: ${normalizePrintablePath(root, schemaPath)}`},
          ])
        }
        const code = generateCode(ast)
        return {ast, code, id, name, tsType}
      }),
  )

  private getAllSanitySchemaTypesDeclaration = createSelector(
    [this.getSchemaTypeDeclarations],
    (schemaTypes) => {
      const ast = t.exportNamedDeclaration(
        t.tsTypeAliasDeclaration(
          ALL_SANITY_SCHEMA_TYPES,
          null,
          schemaTypes.length > 0
            ? t.tsUnionType(schemaTypes.map(({id}) => t.tsTypeReference(id)))
            : t.tsNeverKeyword(),
        ),
      )
      const code = generateCode(ast)

      return {ast, code, id: ALL_SANITY_SCHEMA_TYPES}
    },
  )

  private getArrayOfDeclaration = computeOnce(() => {
    // Creates: type ArrayOf<T> = Array<T & { _key: string }>;
    const typeParam = t.tsTypeParameter(null, null, 'T')
    const intersectionType = t.tsIntersectionType([
      t.tsTypeReference(t.identifier('T')),
      t.tsTypeLiteral([
        t.tsPropertySignature(t.identifier('_key'), t.tsTypeAnnotation(t.tsStringKeyword())),
      ]),
    ])
    const arrayType = t.tsTypeReference(
      t.identifier('Array'),
      t.tsTypeParameterInstantiation([intersectionType]),
    )

    const ast = t.tsTypeAliasDeclaration(
      ARRAY_OF,
      t.tsTypeParameterDeclaration([typeParam]),
      arrayType,
    )
    const code = generateCode(ast)

    return {ast, code, id: ARRAY_OF}
  })

  private getInternalReferenceSymbolDeclaration = computeOnce(() => {
    const typeOperator = t.tsTypeOperator(t.tsSymbolKeyword(), 'unique')

    const id = INTERNAL_REFERENCE_SYMBOL
    id.typeAnnotation = t.tsTypeAnnotation(typeOperator)

    const declaration = t.variableDeclaration('const', [t.variableDeclarator(id)])
    declaration.declare = true
    const ast = t.exportNamedDeclaration(declaration)
    const code = generateCode(ast)

    return {ast, code, id}
  })

  /**
   * Evaluates a projection against its document type, or against every document type when it
   * names none. Document types with the same result share one alias, so a projection that does
   * not apply to most types does not repeat the same type once per document type.
   *
   * Returns `undefined` for a document type this schema does not have when generating for a
   * resource: datasets of one app can scan the same files, and the type can belong to another.
   */
  private static evaluateProjection({
    currentIdentifiers,
    extractedProjection,
    filename,
    resource,
    root,
    schemaTypeGenerator,
  }: {
    currentIdentifiers: Set<string>
    extractedProjection: ExtractedProjection
    filename: string
    resource: TypegenResource | undefined
    root: string
    schemaTypeGenerator: SchemaTypeGenerator
  }): EvaluatedProjection | undefined {
    const {documentType, projection, variable} = extractedProjection
    const documentTypeNames = schemaTypeGenerator.documentTypeNames()
    // Without this, an unknown or non-document type evaluates to `null` and is registered as if
    // it were a result. An object type is a mistake in any run.
    if (documentType !== undefined && !documentTypeNames.includes(documentType)) {
      if (resource && !schemaTypeGenerator.hasType(documentType)) return undefined
      throw new Error(`"${documentType}" is not a document type in the schema`)
    }
    const documentTypes = documentType === undefined ? documentTypeNames : [documentType]

    const groups = new Map<string, {documentTypes: string[]; tsType: t.TSType}>()
    const stats = {allTypes: 0, emptyUnions: 0, unknownTypes: 0}
    for (const type of documentTypes) {
      const result = schemaTypeGenerator.evaluateProjection({documentType: type, projection})
      const key = generateCode(result.tsType)
      const group = groups.get(key)
      if (group) {
        group.documentTypes.push(type)
        continue
      }
      groups.set(key, {documentTypes: [type], tsType: result.tsType})
      stats.allTypes += result.stats.allTypes
      stats.emptyUnions += result.stats.emptyUnions
      stats.unknownTypes += result.stats.unknownTypes
    }

    const identifiers = new Set(currentIdentifiers)
    const trimmedProjection = projection.replaceAll(/(\r\n|\n|\r)/gm, '').trim()
    const declarations: EvaluatedProjection['declarations'] = []
    const resultsByDocumentType: EvaluatedProjection['resultsByDocumentType'] = {}
    for (const group of groups.values()) {
      const name =
        groups.size === 1
          ? variable.id.name
          : `${variable.id.name}${pascalCase(group.documentTypes[0]!)}`
      const id = getUniqueIdentifierForName(resultSuffix(name), identifiers)
      identifiers.add(id.name)
      const ast = t.addComments(
        t.exportNamedDeclaration(t.tsTypeAliasDeclaration(id, null, group.tsType)),
        'leading',
        [
          {type: 'CommentLine', value: ` Source: ${normalizePrintablePath(root, filename)}`},
          {type: 'CommentLine', value: ` Variable: ${variable.id.name}`},
          {
            type: 'CommentLine',
            value: ` Projection on ${group.documentTypes.join(', ')}: ${trimmedProjection}`,
          },
        ],
      )
      declarations.push({ast, code: generateCode(ast), id})
      for (const type of group.documentTypes) resultsByDocumentType[type] = id
    }

    return {...extractedProjection, declarations, resultsByDocumentType, stats}
  }

  private static async getEvaluatedModules({
    queries: extractedModules,
    reporter: report,
    resource,
    root = process.cwd(),
    schemaTypeDeclarations,
    schemaTypeGenerator,
  }: GetEvaluatedModulesOptions) {
    if (!extractedModules) {
      report?.stream.evaluatedModules.end()
      return []
    }

    const currentIdentifiers = new Set<string>(schemaTypeDeclarations.map(({id}) => id.name))
    const evaluatedModuleResults: EvaluatedModule[] = []

    for await (const {filename, ...extractedModule} of extractedModules) {
      const queries: EvaluatedQuery[] = []
      const errors: (QueryEvaluationError | QueryExtractionError)[] = [...extractedModule.errors]

      for (const extractedQuery of extractedModule.queries) {
        const {variable} = extractedQuery
        try {
          const {stats, tsType} = schemaTypeGenerator.evaluateQuery(extractedQuery)
          const id = getUniqueIdentifierForName(resultSuffix(variable.id.name), currentIdentifiers)
          const typeAlias = t.tsTypeAliasDeclaration(id, null, tsType)
          const trimmedQuery = extractedQuery.query.replaceAll(/(\r\n|\n|\r)/gm, '').trim()
          const ast = t.addComments(t.exportNamedDeclaration(typeAlias), 'leading', [
            {type: 'CommentLine', value: ` Source: ${normalizePrintablePath(root, filename)}`},
            {type: 'CommentLine', value: ` Variable: ${variable.id.name}`},
            {type: 'CommentLine', value: ` Query: ${trimmedQuery}`},
          ])

          const evaluatedQueryResult: EvaluatedQuery = {
            ast,
            code: generateCode(ast),
            id,
            stats,
            tsType,
            ...extractedQuery,
          }

          currentIdentifiers.add(id.name)
          queries.push(evaluatedQueryResult)
        } catch (cause) {
          errors.push(new QueryEvaluationError({cause, filename, variable}))
        }
      }

      const projections: EvaluatedProjection[] = []
      for (const extractedProjection of extractedModule.projections ?? []) {
        const {variable} = extractedProjection
        try {
          const evaluatedProjection = TypeGenerator.evaluateProjection({
            currentIdentifiers,
            extractedProjection,
            filename,
            resource,
            root,
            schemaTypeGenerator,
          })
          if (!evaluatedProjection) continue
          for (const {id} of evaluatedProjection.declarations) currentIdentifiers.add(id.name)
          projections.push(evaluatedProjection)
        } catch (cause) {
          errors.push(new QueryEvaluationError({cause, filename, variable}))
        }
      }

      const evaluatedModule: EvaluatedModule = {
        errors,
        filename,
        projections,
        queries,
      }
      report?.stream.evaluatedModules.emit(evaluatedModule)
      evaluatedModuleResults.push(evaluatedModule)
    }
    report?.stream.evaluatedModules.end()

    return evaluatedModuleResults
  }

  /**
   * One property per document type, each holding one property per distinct projection string,
   * typed as the union of every result alias generated for that pair.
   */
  private static getProjectionResultProperties(evaluatedModules: EvaluatedModule[]) {
    const typesByDocumentType: {[documentType: string]: {[projection: string]: string[]}} = {}
    for (const {projections = []} of evaluatedModules) {
      for (const {projection, resultsByDocumentType} of projections) {
        for (const [documentType, id] of Object.entries(resultsByDocumentType)) {
          typesByDocumentType[documentType] ??= {}
          typesByDocumentType[documentType][projection] ??= []
          typesByDocumentType[documentType][projection].push(id.name)
        }
      }
    }

    return Object.entries(typesByDocumentType).map(([documentType, typesByProjection]) =>
      t.tsPropertySignature(
        t.stringLiteral(documentType),
        t.tsTypeAnnotation(
          t.tsTypeLiteral(
            Object.entries(typesByProjection).map(([projection, types]) =>
              t.tsPropertySignature(
                t.stringLiteral(projection),
                t.tsTypeAnnotation(
                  t.tsUnionType(types.map((type) => t.tsTypeReference(t.identifier(type)))),
                ),
              ),
            ),
          ),
        ),
      ),
    )
  }

  private static async getQueryMapDeclaration({
    evaluatedModules,
    overloadClientMethods = true,
  }: GetQueryMapDeclarationOptions) {
    if (!overloadClientMethods) return {ast: t.program([]), code: ''}

    const properties = TypeGenerator.getQueryResultProperties(evaluatedModules)
    if (properties.length === 0) return {ast: t.program([]), code: ''}

    const queryReturnInterface = t.tsInterfaceDeclaration(
      SANITY_QUERIES,
      null,
      [],
      t.tsInterfaceBody(properties),
    )

    const globalRegistry = t.addComments(tsDeclareGlobal([queryReturnInterface]), 'leading', [
      {type: 'CommentLine', value: ' Query TypeMap'},
    ])

    // The client-side global registry: https://github.com/sanity-io/client/pull/1319 (8.x) and
    // https://github.com/sanity-io/client/pull/1320 (7.x)
    const bridge = t.addComments(
      tsDeclareModule('@sanity/client', [
        t.tsInterfaceDeclaration(
          SANITY_QUERIES,
          null,
          [
            t.tsExpressionWithTypeArguments(
              t.tsQualifiedName(t.identifier('globalThis'), SANITY_QUERIES),
            ),
          ],
          t.tsInterfaceBody([]),
        ),
      ]),
      'leading',
      [
        {
          type: 'CommentLine',
          value: ' Lets @sanity/client releases that predate the global registry read it too',
        },
      ],
    )

    const ast = t.program([globalRegistry, bridge])
    const code = generateCode(ast)
    return {ast, code}
  }

  /**
   * One property per distinct query string, typed as the union of every result type generated
   * for it. Two variables holding the same query text share a key.
   */
  private static getQueryResultProperties(evaluatedModules: EvaluatedModule[]) {
    const typesByQuerystring: {[query: string]: string[]} = {}
    for (const {queries} of evaluatedModules) {
      for (const {id, query} of queries) {
        typesByQuerystring[query] ??= []
        typesByQuerystring[query].push(id.name)
      }
    }

    return Object.entries(typesByQuerystring).map(([query, types]) =>
      t.tsPropertySignature(
        t.stringLiteral(query),
        t.tsTypeAnnotation(
          t.tsUnionType(types.map((type) => t.tsTypeReference(t.identifier(type)))),
        ),
      ),
    )
  }

  private static getResourceRegistryDeclaration({
    evaluatedModules,
    resource,
  }: GetQueryMapDeclarationOptions & {resource: TypegenResource}) {
    const key = `${resource.projectId}.${resource.dataset}`

    const schemas = t.tsInterfaceDeclaration(
      SANITY_SCHEMAS_BY_RESOURCE,
      null,
      [],
      t.tsInterfaceBody([
        t.tsPropertySignature(
          t.stringLiteral(key),
          t.tsTypeAnnotation(t.tsTypeReference(ALL_SANITY_SCHEMA_TYPES)),
        ),
      ]),
    )

    // Written even with no queries, and the projection entry below even with no projections. An
    // entry, empty or not, tells consumers this resource is generated, so a query or projection
    // missing from it is a miss rather than a reason to fall back.
    const queries = t.tsInterfaceDeclaration(
      SANITY_QUERIES_BY_RESOURCE,
      null,
      [],
      t.tsInterfaceBody([
        t.tsPropertySignature(
          t.stringLiteral(key),
          t.tsTypeAnnotation(
            t.tsTypeLiteral(TypeGenerator.getQueryResultProperties(evaluatedModules)),
          ),
        ),
      ]),
    )

    const projections = t.tsInterfaceDeclaration(
      SANITY_PROJECTIONS_BY_RESOURCE,
      null,
      [],
      t.tsInterfaceBody([
        t.tsPropertySignature(
          t.stringLiteral(key),
          t.tsTypeAnnotation(
            t.tsTypeLiteral(TypeGenerator.getProjectionResultProperties(evaluatedModules)),
          ),
        ),
      ]),
    )

    // No `declare module "@sanity/client"` bridge, unlike the flat map. These registries first
    // shipped already global, so no client release needs one, and an augmentation would fail
    // with TS2664 wherever `@sanity/client` is not resolvable from the generated file.
    const ast = t.program([
      t.addComments(tsDeclareGlobal([schemas, queries, projections]), 'leading', [
        {type: 'CommentLine', value: ` Resource TypeMap: ${key}`},
      ]),
    ])
    const code = generateCode(ast)
    return {ast, code}
  }

  async generateTypes(options: GenerateTypesOptions) {
    if (options.resource && (!options.resource.projectId || !options.resource.dataset)) {
      throw new TypeError('A typegen resource needs both a projectId and a dataset')
    }

    const {reporter: report} = options
    const internalReferenceSymbol = this.getInternalReferenceSymbolDeclaration()
    const schemaTypeGenerator = this.getSchemaTypeGenerator(options)
    const schemaTypeDeclarations = this.getSchemaTypeDeclarations(options)
    const allSanitySchemaTypesDeclaration = this.getAllSanitySchemaTypesDeclaration(options)

    report?.event.generatedSchemaTypes({
      allSanitySchemaTypesDeclaration,
      internalReferenceSymbol,
      schemaTypeDeclarations,
    })

    // Queries can produce `inline` type nodes that the schema-side generator
    // never sees (e.g. filtering a tagged-union array down to its inline
    // members). Evaluate modules before deciding whether the ArrayOf helper is
    // needed, so query-only usage still triggers the declaration.
    const evaluatedModules = await TypeGenerator.getEvaluatedModules({
      ...options,
      schemaTypeDeclarations,
      schemaTypeGenerator,
    })

    const program = t.program([])
    let code = ''

    program.body.push(internalReferenceSymbol.ast)
    code += internalReferenceSymbol.code

    if (schemaTypeGenerator.isArrayOfUsed()) {
      const arrayOfDeclaration = this.getArrayOfDeclaration()
      program.body.push(arrayOfDeclaration.ast)
      code += arrayOfDeclaration.code
    }

    for (const declaration of schemaTypeDeclarations) {
      program.body.push(declaration.ast)
      code += declaration.code
    }

    program.body.push(allSanitySchemaTypesDeclaration.ast)
    code += allSanitySchemaTypesDeclaration.code

    for (const {queries} of evaluatedModules) {
      for (const query of queries) {
        program.body.push(query.ast)
        code += query.code
      }
    }

    for (const {projections = []} of evaluatedModules) {
      for (const {declarations} of projections) {
        for (const declaration of declarations) {
          program.body.push(declaration.ast)
          code += declaration.code
        }
      }
    }

    const queryMapDeclaration = await TypeGenerator.getQueryMapDeclaration({
      ...options,
      evaluatedModules,
    })
    program.body.push(...queryMapDeclaration.ast.body)
    code += queryMapDeclaration.code

    if (options.resource) {
      const resourceRegistry = TypeGenerator.getResourceRegistryDeclaration({
        ...options,
        evaluatedModules,
        resource: options.resource,
      })
      program.body.push(...resourceRegistry.ast.body)
      code += resourceRegistry.code
    }

    report?.event.generatedQueryTypes({queryMapDeclaration})

    return {ast: program, code}
  }
}

/** `sanity.imageAsset` to `SanityImageAsset`, for naming a result alias after a document type. */
function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('')
}
