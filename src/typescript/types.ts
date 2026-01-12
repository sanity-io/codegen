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
 * A module (file) containing extracted GROQ queries.
 * @public
 */
export interface ExtractedModule {
  errors: QueryExtractionError[]
  filename: string
  queries: ExtractedQuery[]
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
 * A module containing queries that have been evaluated.
 * @public
 */
export interface EvaluatedModule {
  errors: (QueryEvaluationError | QueryExtractionError)[]
  filename: string
  queries: EvaluatedQuery[]
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
