import {readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {env} from 'node:process'

import {type SchemaType} from 'groq-js'

const PENGUIN_PATH = join(homedir(), 'programming/sanity/penguin/schema.json')

/**
 * Returns the parsed penguin `schema.json` when `POLYGLOT_TYPEGEN_PENGUIN=1`, otherwise
 * `undefined`. Lets contributors without the penguin checkout still run `pnpm test`.
 *
 * In a test file, gate the suite on the flag:
 * ```ts
 * const schema = loadPenguinSchema()
 * const maybeIt = schema ? it : it.skip
 * maybeIt('compiles penguin schema', () => { ... })
 * ```
 * @internal
 */
export function loadPenguinSchema(): SchemaType | undefined {
  if (env.POLYGLOT_TYPEGEN_PENGUIN !== '1') return undefined
  try {
    return JSON.parse(readFileSync(PENGUIN_PATH, 'utf8'))
  } catch (err) {
    throw new Error(
      `POLYGLOT_TYPEGEN_PENGUIN=1 was set but the penguin schema could not be read from ${PENGUIN_PATH}: ` +
        (err instanceof Error ? err.message : String(err)),
      {cause: err},
    )
  }
}

/** Path to the penguin schema, exposed so tests can reference it in toolchain scaffolding. */
export const penguinSchemaPath = PENGUIN_PATH
