import {execSync, spawnSync} from 'node:child_process'
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {homedir, tmpdir} from 'node:os'
import {join} from 'node:path'

import {describe, expect, test} from 'vitest'

import {loadPenguinSchema} from '../../__fixtures__/loadPenguinSchema.js'
import {goGenerator} from '../index.js'

function hasGoToolchain(): boolean {
  try {
    execSync('go version', {stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}

const penguinSchema = loadPenguinSchema()
const penguinGoMod = join(homedir(), 'programming/sanity/penguin/go.mod')
const shouldRun = penguinSchema !== undefined && hasGoToolchain() && existsSync(penguinGoMod)
const maybeTest = shouldRun ? test : test.skip

describe('goGenerator: penguin schema acceptance', () => {
  maybeTest(
    'penguin schema compiles with go build using penguin go.mod',
    async () => {
      const output = await goGenerator.generate({
        config: {
          generates: './pkg/sanitytypes/sanity.gen.go',
          packageName: 'sanitytypes',
          schema: './schema.json',
        },

        schema: penguinSchema!,
        workDir: '/tmp/workdir',
      })

      const tmp = mkdtempSync(join(tmpdir(), 'sanity-go-penguin-'))
      try {
        const pkgDir = join(tmp, 'pkg', 'sanitytypes')
        mkdirSync(pkgDir, {recursive: true})
        writeFileSync(join(pkgDir, 'sanity.gen.go'), output.code)
        copyFileSync(penguinGoMod, join(tmp, 'go.mod'))

        const build = spawnSync('go', ['build', './...'], {cwd: tmp, encoding: 'utf8'})
        if (build.status !== 0) {
          throw new Error(
            `go build failed against penguin schema (exit ${build.status}):\n${build.stderr}`,
          )
        }
        expect(build.status).toBe(0)
      } finally {
        rmSync(tmp, {force: true, recursive: true})
      }
    },
    60_000,
  )
})
