import {spawn} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {once} from 'lodash-es'

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../bin/run.js')

interface Options {
  expect: (o: {stderr: string; stdout: string}) => Promise<void> | void

  cwd?: string
  interval?: number
  timeout?: number
}

const isAssertionError = (e: unknown) => e instanceof Error && e.name === 'AssertionError'

export async function testLongRunning(
  command: string[],
  opts: Options,
): Promise<{stderr: string; stdout: string}> {
  const {cwd = process.cwd(), expect: assertion, interval = 150, timeout = 20_000} = opts
  let stderr = '',
    stdout = ''

  // spawn command in child process
  const child = spawn('node', [BIN, ...command], {
    cwd,
    env: {...process.env, NO_COLOR: '1'},
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  // track err and out
  child.stdout?.on('data', (d) => (stdout += d))
  child.stderr?.on('data', (d) => (stderr += d))

  const kill = once(() => child.kill('SIGTERM'))

  // track errors from the child process
  let exitError: Error | null = null
  child.on('exit', (code) => {
    if (code === 0) return
    exitError = new Error(`Process exited with code ${code}\nstderr: ${stderr}`)
  })

  child.on('error', (e) => {
    exitError = e
  })

  // assert once every interval until expectation met, error or timeout
  const start = Date.now()
  async function assertExpectation(): Promise<{stderr: string; stdout: string}> {
    if (exitError) throw exitError

    try {
      await assertion({stderr, stdout})
      return {stderr, stdout}
    } catch (e) {
      if (!isAssertionError(e)) throw e
      if (Date.now() - start > timeout) throw e

      return new Promise((resolve) => {
        setTimeout(() => resolve(assertExpectation()), interval)
      })
    }
  }

  try {
    return await assertExpectation()
  } finally {
    kill()
  }
}
