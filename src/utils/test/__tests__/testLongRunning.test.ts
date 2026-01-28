import {spawn} from 'node:child_process'
import {EventEmitter} from 'node:events'

import {afterEach, beforeEach, describe, expect, type Mock, test, vi} from 'vitest'

import {testLongRunning} from '../testLongRunning.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

interface MockProcess extends EventEmitter {
  kill: Mock
  stderr: EventEmitter
  stdout: EventEmitter
}

/* eslint-disable unicorn/prefer-event-target -- mocking Node.js child_process which uses EventEmitter */
function createMockProcess(): MockProcess {
  return Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    stderr: new EventEmitter(),
    stdout: new EventEmitter(),
  })
}
/* eslint-enable unicorn/prefer-event-target */

describe('testLongRunning', () => {
  let mockProc: MockProcess

  beforeEach(() => {
    mockProc = createMockProcess()
    vi.mocked(spawn).mockReturnValue(mockProc as never)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('resolves when assertion passes', async () => {
    const promise = testLongRunning(['typegen', 'generate', '--watch'], {
      expect: ({stdout}) => {
        expect(stdout).toContain('ready')
      },
    })

    mockProc.stdout.emit('data', 'ready')

    const result = await promise
    expect(result.stdout).toBe('ready')
    expect(mockProc.kill).toHaveBeenCalled()
  })

  test('retries until assertion passes', async () => {
    let attempts = 0

    const promise = testLongRunning(['typegen', 'generate', '--watch'], {
      expect: ({stdout}) => {
        attempts++
        expect(stdout).toContain('ready')
      },
      interval: 10,
    })

    // Emit output after a delay
    setTimeout(() => mockProc.stdout.emit('data', 'ready'), 50)

    await promise
    expect(attempts).toBeGreaterThan(1)
  })

  test('rejects when process exits with error', async () => {
    const promise = testLongRunning(['typegen', 'generate', '--watch'], {
      expect: ({stdout}) => {
        expect(stdout).toContain('ready')
      },
      interval: 10,
    })

    mockProc.stderr.emit('data', 'something went wrong')
    mockProc.emit('exit', 1)

    await expect(promise).rejects.toThrow('Process exited with code 1')
  })

  test('rejects when timeout is reached', async () => {
    const promise = testLongRunning(['typegen', 'generate', '--watch'], {
      expect: ({stdout}) => {
        expect(stdout).toContain('never-gonna-happen')
      },
      interval: 10,
      timeout: 50,
    })

    await expect(promise).rejects.toThrow()
    expect(mockProc.kill).toHaveBeenCalled()
  })

  test('rejects immediately on non-assertion error', async () => {
    const customError = new Error('something broke')

    const promise = testLongRunning(['typegen', 'generate', '--watch'], {
      expect: () => {
        throw customError
      },
    })

    await expect(promise).rejects.toBe(customError)
    expect(mockProc.kill).toHaveBeenCalled()
  })

  test('accumulates stdout and stderr', async () => {
    const promise = testLongRunning(['typegen', 'generate', '--watch'], {
      expect: ({stderr, stdout}) => {
        expect(stdout).toContain('out2')
        expect(stderr).toContain('err2')
      },
      interval: 10,
    })

    mockProc.stdout.emit('data', 'out1')
    mockProc.stderr.emit('data', 'err1')

    setTimeout(() => {
      mockProc.stdout.emit('data', 'out2')
      mockProc.stderr.emit('data', 'err2')
    }, 30)

    const result = await promise
    expect(result.stdout).toBe('out1out2')
    expect(result.stderr).toBe('err1err2')
  })
})
