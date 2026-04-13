import {readFile} from 'node:fs/promises'

import {type SchemaType} from 'groq-js'

/**
 * Read a schema from a given path and validate its structure.
 * @param path - The path to the schema
 * @returns The schema
 * @internal
 * @beta
 **/
export async function readSchema(path: string): Promise<SchemaType> {
  const content = await readFile(path, 'utf8')

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (cause) {
    throw new Error(
      `Failed to parse schema file "${path}" as JSON. The file may be empty or corrupted — ` +
        `try running "sanity schema extract" to regenerate it.`,
      {cause},
    )
  }

  if (!Array.isArray(parsed)) {
    throw new TypeError(
      `Invalid schema file "${path}": expected an array of schema types, ` +
        `got ${parsed === null ? 'null' : typeof parsed}. ` +
        `Try running "sanity schema extract" to regenerate it.`,
    )
  }

  if (parsed.length === 0) {
    throw new Error(
      `Schema file "${path}" contains an empty array. ` +
        `This usually means schema extraction did not produce any types — ` +
        `check that your Sanity configuration and environment variables are correct.`,
    )
  }

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null || !('type' in entry) || !('name' in entry)) {
      throw new Error(
        `Invalid schema file "${path}": each entry must have "type" and "name" properties. ` +
          `The file may be corrupted — try running "sanity schema extract" to regenerate it.`,
      )
    }
  }

  return parsed as SchemaType
}
