import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterAll, beforeAll, describe, expect, test} from 'vitest'

import {readSchema} from '../readSchema.js'

describe('readSchema', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'readSchema-'))
  })

  afterAll(async () => {
    await rm(tmpDir, {recursive: true})
  })

  test('reads and returns a valid schema', async () => {
    const schema = await readSchema(join(__dirname, '../../dev/schema.json'))
    expect(Array.isArray(schema)).toBe(true)
    expect(schema.length).toBeGreaterThan(0)
    expect(schema[0]).toHaveProperty('type')
    expect(schema[0]).toHaveProperty('name')
  })

  test('throws a clear error for invalid JSON', async () => {
    const path = join(tmpDir, 'invalid.json')
    await writeFile(path, 'not json at all', 'utf8')

    await expect(readSchema(path)).rejects.toThrow('Failed to parse schema file')
    await expect(readSchema(path)).rejects.toThrow('try running "sanity schema extract"')
  })

  test('throws a clear error for an empty file', async () => {
    const path = join(tmpDir, 'empty.json')
    await writeFile(path, '', 'utf8')

    await expect(readSchema(path)).rejects.toThrow('Failed to parse schema file')
  })

  test('throws a clear error when schema is not an array', async () => {
    const path = join(tmpDir, 'not-array.json')
    await writeFile(path, JSON.stringify({type: 'object'}), 'utf8')

    await expect(readSchema(path)).rejects.toThrow('expected an array of schema types')
    await expect(readSchema(path)).rejects.toThrow('got object')
  })

  test('throws a clear error when schema is null', async () => {
    const path = join(tmpDir, 'null.json')
    await writeFile(path, 'null', 'utf8')

    await expect(readSchema(path)).rejects.toThrow('expected an array of schema types')
    await expect(readSchema(path)).rejects.toThrow('got null')
  })

  test('throws a clear error when schema is an empty array', async () => {
    const path = join(tmpDir, 'empty-array.json')
    await writeFile(path, '[]', 'utf8')

    await expect(readSchema(path)).rejects.toThrow('contains an empty array')
    await expect(readSchema(path)).rejects.toThrow('environment variables')
  })

  test('throws a clear error when schema entries are malformed', async () => {
    const path = join(tmpDir, 'malformed.json')
    await writeFile(path, JSON.stringify([{foo: 'bar'}]), 'utf8')

    await expect(readSchema(path)).rejects.toThrow(
      'each entry must have "type" and "name" properties',
    )
  })
})
