import {execFileSync, spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

import {type SchemaType} from 'groq-js'
import {describe, expect, it} from 'vitest'

import {phpGenerator} from '../index.js'

const fixturePath = fileURLToPath(
  new URL('../../__fixtures__/kitchen-sink-schema.json', import.meta.url),
)

function phpAvailable(): boolean {
  const probe = spawnSync('php', ['--version'], {stdio: 'ignore'})
  return probe.status === 0
}

const phpOnPath = phpAvailable()

describe.skipIf(!phpOnPath)('phpGenerator (`php -l` toolchain test)', () => {
  it('emits a file that passes `php -l`', async () => {
    const schema = JSON.parse(readFileSync(fixturePath, 'utf8')) as SchemaType
    const config = phpGenerator.parseConfig({
      generates: './generated.php',
      schema: './schema.json',
    })
    const {code} = await phpGenerator.generate({
      config,
      schema,
      workDir: '/tmp/php-lint',
    })

    const dir = mkdtempSync(join(tmpdir(), 'php-lint-'))
    const filePath = join(dir, 'generated.php')
    writeFileSync(filePath, code, 'utf8')

    const out = execFileSync('php', ['-l', filePath], {encoding: 'utf8'})
    expect(out).toMatch(/No syntax errors detected/)
  })

  it('hydrates a sample JSON document via `Post::fromArray` with the expected typed property values', async () => {
    const schema = JSON.parse(readFileSync(fixturePath, 'utf8')) as SchemaType
    const config = phpGenerator.parseConfig({
      generates: './generated.php',
      schema: './schema.json',
    })
    const {code} = await phpGenerator.generate({
      config,
      schema,
      workDir: '/tmp/php-e2e',
    })

    const dir = mkdtempSync(join(tmpdir(), 'php-e2e-'))
    const filePath = join(dir, 'generated.php')
    writeFileSync(filePath, code, 'utf8')

    const samplePost = {
      _createdAt: '2026-01-01T00:00:00Z',
      _id: 'post-1',
      _rev: 'rev-1',
      _type: 'post',
      _updatedAt: '2026-01-02T00:00:00Z',
      author: {_ref: 'author-1', _type: 'reference'},
      body: [
        {_type: 'link', href: 'https://example.com', label: 'home'},
        {_type: 'callout', message: 'hello'},
      ],
      class: 'header',
      featured: true,
      func: 'bar',
      publishedAt: '2026-01-01T00:00:00Z',
      rating: 4.5,
      slug: {_type: 'slug', current: 'hello-world'},
      tags: ['php', 'sanity'],
      title: 'Hello',
      url: 'https://example.com/post',
    }
    const sampleJson = JSON.stringify(samplePost)

    const harness = `<?php
require '${filePath}';

use Sanity\\Generated\\Post;
use Sanity\\Generated\\Reference;
use Sanity\\Generated\\Slug;
use Sanity\\Generated\\Link;
use Sanity\\Generated\\Post_BodyCallout;

$data = json_decode(<<<'JSON'
${sampleJson}
JSON
, true);
$post = Post::fromArray($data);
assert($post instanceof Post, 'fromArray did not return a Post');
assert($post->_id === 'post-1', '_id mismatch');
assert($post->_type === 'post', '_type mismatch');
assert($post->title === 'Hello', 'title mismatch');
assert($post->featured === true, 'featured mismatch');
assert($post->rating === 4.5, 'rating mismatch');
assert($post->slug instanceof Slug, 'slug not hydrated to Slug');
assert($post->slug->current === 'hello-world', 'slug.current mismatch');
assert($post->author instanceof Reference, 'author not hydrated to Reference');
assert($post->author->_ref === 'author-1', 'author._ref mismatch');
assert($post->tags === ['php', 'sanity'], 'tags mismatch');
assert($post->class_ === 'header', 'renamed class_ property mismatch');
assert($post->func === 'bar', 'func mismatch');
assert(is_array($post->body) && count($post->body) === 2, 'body length mismatch');
assert($post->body[0] instanceof Link, 'body[0] not Link');
assert($post->body[0]->href === 'https://example.com', 'body[0].href mismatch');
assert($post->body[1] instanceof Post_BodyCallout, 'body[1] not Post_BodyCallout');
assert($post->body[1]->message === 'hello', 'body[1].message mismatch');
echo "OK\\n";
`
    const harnessPath = join(dir, 'run.php')
    writeFileSync(harnessPath, harness, 'utf8')

    const out = execFileSync(
      'php',
      ['-d', 'zend.assertions=1', '-d', 'assert.exception=1', harnessPath],
      {
        encoding: 'utf8',
      },
    )
    expect(out.trim()).toBe('OK')
  })
})

if (!phpOnPath) {
  describe('phpGenerator (`php -l` toolchain test)', () => {
    it.skip('skipped because `php` is not on $PATH', () => {})
  })
}
