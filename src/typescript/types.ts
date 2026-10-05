import type * as t from '@babel/types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  (typeof value === 'object' || typeof value === 'function') && !!value

/**
 * Statistics from the query type evaluation process.
 * @public
 */
export interface TypeEvaluationStats {
  allTypes: number
  emptyUnions: number
  unknownTypes: number
}

interface QueryVariable {
  id: t.Identifier

  end?: number
  start?: number
}

/**
 * A GROQ query extracted from a source file.
 * @public
 */
export interface ExtractedQuery {
  filename: string
  query: string
  variable: QueryVariable
}

/**
 * A projection extracted from a `defineProjection` call in a source file.
 * @beta
 */
export interface ExtractedProjection {
  filename: string
  /** The exact projection string, which is also its lookup key. */
  projection: string
  variable: QueryVariable

  /**
   * The document type the projection is written for, when passed as the first argument.
   * Without it, the projection is evaluated against every document type.
   */
  documentType?: string
}

/**
 * A module (file) containing extracted GROQ queries.
 * @public
 */
export interface ExtractedModule {
  errors: QueryExtractionError[]
  filename: string
  queries: ExtractedQuery[]

  /** @beta */
  projections?: ExtractedProjection[]
}

/**
 * An `ExtractedQuery` that has been evaluated against a schema, yielding a TypeScript type.
 * @public
 */
export interface EvaluatedQuery extends ExtractedQuery {
  ast: t.ExportNamedDeclaration
  code: string
  id: t.Identifier
  stats: TypeEvaluationStats
  tsType: t.TSType
}

/**
 * An `ExtractedProjection` evaluated against the document types it applies to.
 * @beta
 */
export interface EvaluatedProjection extends ExtractedProjection {
  /** One result type alias per distinct result. */
  declarations: {ast: t.ExportNamedDeclaration; code: string; id: t.Identifier}[]
  /** The result alias for each document type the projection was evaluated against. */
  resultsByDocumentType: {[documentType: string]: t.Identifier}
  stats: TypeEvaluationStats
}

/**
 * A module containing queries that have been evaluated.
 * @public
 */
export interface EvaluatedModule {
  errors: (QueryEvaluationError | QueryExtractionError)[]
  filename: string
  queries: EvaluatedQuery[]

  /** @beta */
  projections?: EvaluatedProjection[]
}

interface QueryExtractionErrorOptions {
  cause: unknown
  filename: string

  variable?: QueryVariable
}

/**
 * An error that occurred during query extraction.
 * @public
 */
export class QueryExtractionError extends Error {
  filename: string
  variable?: QueryVariable
  constructor({cause, filename, variable}: QueryExtractionErrorOptions) {
    super(
      `Error while extracting query ${variable ? `from variable '${variable.id.name}' ` : ''}in ${filename}: ${
        isRecord(cause) && typeof cause.message === 'string' ? cause.message : 'Unknown error'
      }`,
    )
    this.name = 'QueryExtractionError'
    this.cause = cause
    this.variable = variable
    this.filename = filename
  }
}

interface QueryEvaluationErrorOptions {
  cause: unknown
  filename: string

  variable?: QueryVariable
}

/**
 * An error that occurred during query evaluation.
 * @public
 */
export class QueryEvaluationError extends Error {
  filename: string
  variable?: QueryVariable
  constructor({cause, filename, variable}: QueryEvaluationErrorOptions) {
    super(
      `Error while evaluating query ${variable ? `from variable '${variable.id.name}' ` : ''}in ${filename}: ${
        isRecord(cause) && typeof cause.message === 'string' ? cause.message : 'Unknown error'
      }`,
    )
    this.name = 'QueryEvaluationError'
    this.cause = cause
    this.variable = variable
    this.filename = filename
  }
}
