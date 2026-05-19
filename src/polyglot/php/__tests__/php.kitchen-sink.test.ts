import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

import {type SchemaType} from 'groq-js'
import {describe, expect, it} from 'vitest'

import {phpGenerator} from '../index.js'

const fixturePath = fileURLToPath(
  new URL('../../__fixtures__/kitchen-sink-schema.json', import.meta.url),
)
const schema = JSON.parse(readFileSync(fixturePath, 'utf8')) as SchemaType

describe('phpGenerator (kitchen-sink)', () => {
  it('emits a self-contained file with declare(strict_types=1), namespace, inlined shared shapes, and per-document fromArray factories', async () => {
    const config = phpGenerator.parseConfig({
      generates: './generated.php',
      schema: './schema.json',
    })
    const result = await phpGenerator.generate({
      config,
      schema,
      workDir: '/tmp/php-fixture',
    })

    expect(result.code).toMatchSnapshot()
  })

  it('uses the configured custom namespace', async () => {
    const config = phpGenerator.parseConfig({
      generates: './generated.php',
      namespace: 'App\\Sanity\\Generated',
      schema: './schema.json',
    })
    const {code} = await phpGenerator.generate({
      config,
      schema,
      workDir: '/tmp/php-fixture',
    })
    expect(code).toContain('namespace App\\Sanity\\Generated;')
  })

  it('reports document and object counts in stats', async () => {
    const config = phpGenerator.parseConfig({
      generates: './generated.php',
      schema: './schema.json',
    })
    const {stats} = await phpGenerator.generate({
      config,
      schema,
      workDir: '/tmp/php-fixture',
    })
    // author, post, page → 3 documents; link → 1 named object.
    expect(stats.documents).toBe(3)
    expect(stats.objects).toBe(1)
  })
})
