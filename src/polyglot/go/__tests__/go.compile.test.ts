import {execSync, spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {type SchemaType} from 'groq-js'
import {describe, expect, test} from 'vitest'

import {goGenerator} from '../index.js'

function hasGoToolchain(): boolean {
  try {
    execSync('go version', {stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}

function loadKitchenSink(): SchemaType {
  const path = join(__dirname, '..', '..', '__fixtures__', 'kitchen-sink-schema.json')
  return JSON.parse(readFileSync(path, 'utf8'))
}

const maybeTest = hasGoToolchain() ? test : test.skip

describe('goGenerator: go build acceptance', () => {
  maybeTest(
    'kitchen-sink output compiles with go build',
    async () => {
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

      const tmp = mkdtempSync(join(tmpdir(), 'sanity-go-typegen-'))
      try {
        const pkgDir = join(tmp, 'pkg', 'sanitytypes')
        mkdirSync(pkgDir, {recursive: true})
        writeFileSync(join(pkgDir, 'sanity.gen.go'), output.code)
        writeFileSync(join(tmp, 'go.mod'), 'module sanitytypegen.test\n\ngo 1.24\n')

        const build = spawnSync('go', ['build', './...'], {cwd: tmp, encoding: 'utf8'})
        if (build.status !== 0) {
          throw new Error(
            `go build failed (exit ${build.status}):\n--- stdout ---\n${build.stdout}\n--- stderr ---\n${build.stderr}`,
          )
        }
        expect(build.status).toBe(0)
      } finally {
        rmSync(tmp, {force: true, recursive: true})
      }
    },
    30_000,
  )
})
