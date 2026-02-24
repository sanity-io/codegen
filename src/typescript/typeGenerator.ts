/* eslint-disable unicorn/consistent-function-scoping */
import process from 'node:process'

import * as t from '@babel/types'
import {type WorkerChannel, type WorkerChannelReporter} from '@sanity/worker-channels'
import {type SchemaType, type TypeNode} from 'groq-js'
import {createSelector} from 'reselect'

import {resultSuffix} from '../casing.js'
import {
  ALL_SANITY_SCHEMA_TYPES,
  ARRAY_OF,
  INTERNAL_REFERENCE_SYMBOL,
  SANITY_QUERIES,
} from './constants.js'
import {
  computeOnce,
  generateCode,
  getUniqueIdentifierForName,
  normalizePrintablePath,
} from './helpers.js'
import {SchemaTypeGenerator} from './schemaTypeGenerator.js'
import {buildDeduplicationRegistry, collectObjectFingerprints} from './typeNodeFingerprint.js'
import {
  type EvaluatedModule,
  type EvaluatedQuery,
  type ExtractedModule,
  type ExtractedQuery,
  QueryEvaluationError,
  type QueryExtractionError,
  type TypeEvaluationStats,
} from './types.js'

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

export interface GenerateTypesOptions {
  schema: SchemaType

  overloadClientMethods?: boolean
  queries?: AsyncIterable<ExtractedModule>
  reporter?: WorkerChannelReporter<TypegenWorkerChannel>
  root?: string
  schemaPath?: string
}

type GetQueryMapDeclarationOptions = GenerateTypesOptions & {
  evaluatedModules: EvaluatedModule[]
}

interface CollectedModule {
  errors: (QueryEvaluationError | QueryExtractionError)[]
  filename: string
  queries: CollectedQuery[]
}

interface CollectedQuery extends ExtractedQuery {
  stats: TypeEvaluationStats
  typeNode: TypeNode
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
   * Phase 1: Collect TypeNodes from all extracted modules without generating TS types.
   */
  private static async collectModules(
    extractedModules: AsyncIterable<ExtractedModule> | undefined,
    schemaTypeGenerator: SchemaTypeGenerator,
  ): Promise<CollectedModule[]> {
    if (!extractedModules) return []

    const collectedModules: CollectedModule[] = []

    for await (const {filename, ...extractedModule} of extractedModules) {
      const queries: CollectedQuery[] = []
      const errors: (QueryEvaluationError | QueryExtractionError)[] = [...extractedModule.errors]

      for (const extractedQuery of extractedModule.queries) {
        const {variable} = extractedQuery
        try {
          const {stats, typeNode} = schemaTypeGenerator.evaluateQueryTypeNode(extractedQuery)
          queries.push({...extractedQuery, stats, typeNode})
        } catch (cause) {
          errors.push(new QueryEvaluationError({cause, filename, variable}))
        }
      }

      collectedModules.push({errors, filename, queries})
    }

    return collectedModules
  }

  /**
   * Phase 3: Generate TS types from collected modules (after dedup registry is set).
   */
  private static generateEvaluatedModules({
    collectedModules,
    currentIdentifiers,
    reporter: report,
    root = process.cwd(),
    schemaTypeGenerator,
  }: {
    collectedModules: CollectedModule[]
    currentIdentifiers: Set<string>
    reporter?: WorkerChannelReporter<TypegenWorkerChannel>
    root?: string
    schemaTypeGenerator: SchemaTypeGenerator
  }): EvaluatedModule[] {
    const evaluatedModuleResults: EvaluatedModule[] = []

    for (const collectedModule of collectedModules) {
      const queries: EvaluatedQuery[] = []

      for (const collectedQuery of collectedModule.queries) {
        const {variable} = collectedQuery
        const tsType = schemaTypeGenerator.generateQueryTsType(collectedQuery.typeNode)
        const id = getUniqueIdentifierForName(resultSuffix(variable.id.name), currentIdentifiers)
        const typeAlias = t.tsTypeAliasDeclaration(id, null, tsType)
        const trimmedQuery = collectedQuery.query.replaceAll(/(\r\n|\n|\r)/gm, '').trim()
        const ast = t.addComments(t.exportNamedDeclaration(typeAlias), 'leading', [
          {
            type: 'CommentLine',
            value: ` Source: ${normalizePrintablePath(root, collectedModule.filename)}`,
          },
          {type: 'CommentLine', value: ` Variable: ${variable.id.name}`},
          {type: 'CommentLine', value: ` Query: ${trimmedQuery}`},
        ])

        const evaluatedQueryResult: EvaluatedQuery = {
          ...collectedQuery,
          ast,
          code: generateCode(ast),
          id,
          tsType,
        }

        currentIdentifiers.add(id.name)
        queries.push(evaluatedQueryResult)
      }

      const evaluatedModule: EvaluatedModule = {
        errors: collectedModule.errors,
        filename: collectedModule.filename,
        queries,
      }
      report?.stream.evaluatedModules.emit(evaluatedModule)
      evaluatedModuleResults.push(evaluatedModule)
    }
    report?.stream.evaluatedModules.end()

    return evaluatedModuleResults
  }

  private static async getQueryMapDeclaration({
    evaluatedModules,
    overloadClientMethods = true,
  }: GetQueryMapDeclarationOptions) {
    if (!overloadClientMethods) return {ast: t.program([]), code: ''}

    const queries = evaluatedModules.flatMap((module) => module.queries)
    if (queries.length === 0) return {ast: t.program([]), code: ''}

    const typesByQuerystring: {[query: string]: string[]} = {}
    for (const {id, query} of queries) {
      typesByQuerystring[query] ??= []
      typesByQuerystring[query].push(id.name)
    }

    const queryReturnInterface = t.tsInterfaceDeclaration(
      SANITY_QUERIES,
      null,
      [],
      t.tsInterfaceBody(
        Object.entries(typesByQuerystring).map(([query, types]) => {
          return t.tsPropertySignature(
            t.stringLiteral(query),
            t.tsTypeAnnotation(
              types.length > 0
                ? t.tsUnionType(types.map((type) => t.tsTypeReference(t.identifier(type))))
                : t.tsNeverKeyword(),
            ),
          )
        }),
      ),
    )

    const declareModule = t.declareModule(
      t.stringLiteral('@sanity/client'),
      t.blockStatement([queryReturnInterface]),
    )

    const clientImport = t.addComments(
      t.importDeclaration([], t.stringLiteral('@sanity/client')),
      'leading',
      [{type: 'CommentLine', value: ' Query TypeMap'}],
    )

    const ast = t.program([clientImport, declareModule])
    const code = generateCode(ast)
    return {ast, code}
  }

  async generateTypes(options: GenerateTypesOptions) {
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

    const program = t.program([])
    let code = ''

    for (const declaration of schemaTypeDeclarations) {
      program.body.push(declaration.ast)
      code += declaration.code
    }

    program.body.push(allSanitySchemaTypesDeclaration.ast)
    code += allSanitySchemaTypesDeclaration.code

    program.body.push(internalReferenceSymbol.ast)
    code += internalReferenceSymbol.code

    // Phase 1: Collect TypeNodes from all queries
    const collectedModules = await TypeGenerator.collectModules(
      options.queries,
      schemaTypeGenerator,
    )

    // Phase 2: Build deduplication registry from all collected TypeNodes
    const allTypeNodes = collectedModules.flatMap((m) => m.queries.map((q) => q.typeNode))
    const fingerprints = collectObjectFingerprints(allTypeNodes)
    const currentIdentifiers = new Set<string>(schemaTypeDeclarations.map(({id}) => id.name))
    const registry = buildDeduplicationRegistry(fingerprints, currentIdentifiers)
    schemaTypeGenerator.setDeduplicationRegistry(registry)

    // Emit extracted deduplicated type declarations
    for (const [fp, {id, typeNode}] of registry.extractedTypes) {
      currentIdentifiers.add(id.name)
      const body = schemaTypeGenerator.generateExtractedTypeTsType(typeNode, fp)
      const typeAlias = t.tsTypeAliasDeclaration(id, null, body)
      const ast = typeAlias
      const extractedCode = generateCode(ast)
      program.body.push(ast)
      code += extractedCode
    }

    // Phase 3: Generate TS types from collected modules (with dedup active)
    const evaluatedModules = TypeGenerator.generateEvaluatedModules({
      collectedModules,
      currentIdentifiers,
      reporter: report,
      root: options.root,
      schemaTypeGenerator,
    })

    if (!options.queries) {
      report?.stream.evaluatedModules.end()
    }

    // Only generate ArrayOf if it's actually used
    if (schemaTypeGenerator.isArrayOfUsed()) {
      const arrayOfDeclaration = this.getArrayOfDeclaration()
      program.body.push(arrayOfDeclaration.ast)
      code += arrayOfDeclaration.code
    }

    for (const {queries} of evaluatedModules) {
      for (const query of queries) {
        program.body.push(query.ast)
        code += query.code
      }
    }

    const queryMapDeclaration = await TypeGenerator.getQueryMapDeclaration({
      ...options,
      evaluatedModules,
    })
    program.body.push(...queryMapDeclaration.ast.body)
    code += queryMapDeclaration.code

    report?.event.generatedQueryTypes({queryMapDeclaration})

    return {ast: program, code}
  }
}
