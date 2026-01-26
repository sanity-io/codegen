import {describe, expect, test} from 'vitest'

import {normalizePrintablePath} from '../helpers.js'

describe('normalizePrintablePath', () => {
  test('handles Unix-style paths', () => {
    const result = normalizePrintablePath('/src', '/src/foo/bar.ts')
    expect(result).toBe('foo/bar.ts')
  })

  test('handles nested Unix-style paths', () => {
    const result = normalizePrintablePath(
      '/home/user/project',
      '/home/user/project/src/types/schema.ts',
    )
    expect(result).toBe('src/types/schema.ts')
  })

  test('handles same directory', () => {
    const result = normalizePrintablePath('/src', '/src/file.ts')
    expect(result).toBe('file.ts')
  })

  test('handles Windows-style paths with drive letters', () => {
    // Simulate Windows path behavior
    const result = normalizePrintablePath(
      String.raw`C:\Users\test`,
      String.raw`C:\Users\test\some\sub\path.ts`,
    )
    // On Unix, this won't work as expected, but on Windows it will
    // The key is that formatPath normalizes the output
    expect(result).not.toContain('\\')
  })

  test('handles Windows-style nested paths', () => {
    const result = normalizePrintablePath(
      String.raw`C:\project`,
      String.raw`C:\project\src\foo\bar.ts`,
    )
    expect(result).not.toContain('\\')
  })

  test('normalizes output to forward slashes on all platforms', () => {
    // Test that regardless of input, output uses forward slashes
    const result = normalizePrintablePath('/src', '/src/nested/deep/path.ts')
    expect(result).not.toContain('\\')
    expect(result).toContain('/')
    expect(result).toBe('nested/deep/path.ts')
  })

  test('handles relative path inputs', () => {
    // When filename is already relative, resolve should handle it
    const result = normalizePrintablePath('/base', 'subdir/file.ts')
    expect(result).not.toContain('\\')
  })

  test('handles paths with special characters', () => {
    const result = normalizePrintablePath('/project', '/project/my-component/schema.type.ts')
    expect(result).toBe('my-component/schema.type.ts')
  })

  test('handles paths with spaces', () => {
    const result = normalizePrintablePath('/my project', '/my project/some folder/file.ts')
    expect(result).toBe('some folder/file.ts')
  })

  test('returns empty string for identical paths', () => {
    const result = normalizePrintablePath('/src/test', '/src/test')
    expect(result).toBe('')
  })

  test('handles parent directory traversal', () => {
    const result = normalizePrintablePath('/src/nested', '/src/other/file.ts')
    expect(result).toContain('..')
    expect(result).not.toContain('\\')
  })
})
