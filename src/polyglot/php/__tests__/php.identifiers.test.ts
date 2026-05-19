import {type SchemaType} from 'groq-js'
import {describe, expect, it} from 'vitest'

import {phpClassName, phpPropertyIdentifier} from '../identifiers.js'
import {phpGenerator} from '../index.js'

describe('phpPropertyIdentifier (reserved-word rename rule)', () => {
  it('renames `class` to `class_` and preserves the json key', () => {
    const ident = phpPropertyIdentifier('class')
    expect(ident.name).toBe('class_')
    expect(ident.jsonKey).toBe('class')
    expect(ident.renamed).toBe(true)
  })

  it('renames `function` and `match` (PHP reserved) but not `func` (which is reserved in Go, not PHP)', () => {
    expect(phpPropertyIdentifier('function').name).toBe('function_')
    expect(phpPropertyIdentifier('match').name).toBe('match_')
    expect(phpPropertyIdentifier('func').name).toBe('func')
  })

  it('preserves verbatim names including leading underscores (`_id`, `_type`)', () => {
    expect(phpPropertyIdentifier('_id').name).toBe('_id')
    expect(phpPropertyIdentifier('_type').name).toBe('_type')
    expect(phpPropertyIdentifier('publishedAt').name).toBe('publishedAt')
  })
})

describe('phpClassName', () => {
  it('pascal-cases simple names', () => {
    expect(phpClassName('post')).toBe('Post')
    expect(phpClassName('blockContent')).toBe('BlockContent')
    expect(phpClassName('block_content')).toBe('BlockContent')
  })
})

describe('namespace-collision guard (R11)', () => {
  it('rejects a class whose fully-qualified name matches a sanity-php reserved class', async () => {
    // A schema with a document named `patch` would emit `Sanity\Generated\Patch`,
    // which would NOT collide because the FQN differs from `Sanity\Patch`.
    // We instead pick the user-overridable namespace `Sanity` (the bare root) so
    // the collision is reachable from a real config path.
    const schema: SchemaType = [
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'patch'}},
        },
        name: 'patch',
        type: 'document',
      },
    ]

    const config = phpGenerator.parseConfig({
      generates: './out.php',
      namespace: 'Sanity',
      schema: './schema.json',
    })

    await expect(
      phpGenerator.generate({config, schema, workDir: '/tmp/php-collision'}),
    ).rejects.toThrow(/Sanity\\Patch/)
  })

  it('accepts the same class name under a non-conflicting namespace', async () => {
    const schema: SchemaType = [
      {
        attributes: {
          _id: {type: 'objectAttribute', value: {type: 'string'}},
          _type: {type: 'objectAttribute', value: {type: 'string', value: 'patch'}},
        },
        name: 'patch',
        type: 'document',
      },
    ]

    const config = phpGenerator.parseConfig({
      generates: './out.php',
      namespace: 'App\\Sanity\\Generated',
      schema: './schema.json',
    })

    const {code} = await phpGenerator.generate({
      config,
      schema,
      workDir: '/tmp/php-collision',
    })
    expect(code).toContain('class Patch')
  })
})
