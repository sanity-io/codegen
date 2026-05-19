import {readFileSync} from 'node:fs'
import {join} from 'node:path'

import {type SchemaType} from 'groq-js'
import {describe, expect, test} from 'vitest'

import {goGenerator} from '../index.js'

function loadKitchenSink(): SchemaType {
  const path = join(__dirname, '..', '..', '__fixtures__', 'kitchen-sink-schema.json')
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('goGenerator: kitchen-sink schema', () => {
  test('emits a deterministic snapshot', async () => {
    const schema = loadKitchenSink()
    const output = await goGenerator.generate({
      config: {
        generates: './pkg/sanitytypes/sanity.gen.go',
        packageName: 'sanitytypes',
        schema: './schema.json',
      },
      schema,
      workDir: '/tmp/workdir',
    })
    expect(output.code).toMatchSnapshot()
  })

  test('reports document and object counts', async () => {
    const schema = loadKitchenSink()
    const output = await goGenerator.generate({
      config: {
        generates: './pkg/sanitytypes/sanity.gen.go',
        packageName: 'sanitytypes',
        schema: './schema.json',
      },
      schema,
      workDir: '/tmp/workdir',
    })
    expect(output.stats.documents).toBe(3)
    expect(output.stats.objects).toBe(1)
  })

  test('preserves wire names in json struct tags', async () => {
    const schema = loadKitchenSink()
    const output = await goGenerator.generate({
      config: {
        generates: './pkg/sanitytypes/sanity.gen.go',
        packageName: 'sanitytypes',
        schema: './schema.json',
      },
      schema,
      workDir: '/tmp/workdir',
    })
    expect(output.code).toContain('`json:"publishedAt,omitempty"`')
    expect(output.code).toContain('`json:"_type"')
    expect(output.code).toContain('`json:"class,omitempty"`')
    expect(output.code).toContain('`json:"func,omitempty"`')
  })

  test('emits Reference shared shape and union helper when used', async () => {
    const schema = loadKitchenSink()
    const output = await goGenerator.generate({
      config: {
        generates: './pkg/sanitytypes/sanity.gen.go',
        packageName: 'sanitytypes',
        schema: './schema.json',
      },
      schema,
      workDir: '/tmp/workdir',
    })
    expect(output.code).toContain('type Reference struct')
    expect(output.code).toContain('type Document struct')
    expect(output.code).toContain('UnmarshalPostBody')
    expect(output.code).toContain('encoding/json')
    expect(output.code).toContain('fmt')
  })
})
