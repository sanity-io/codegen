/**
 * Formats a path so it is the same in Windows and Unix
 * @param path - The path to format
 */
export function formatPath(path: string): string {
  return path.replaceAll('\\', '/')
}
