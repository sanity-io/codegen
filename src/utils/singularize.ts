export function singularize(name: string): string {
  if (name.endsWith('ies') && name.length > 3) {
    return name.slice(0, -3) + 'y'
  }
  if (
    name.endsWith('sses') ||
    name.endsWith('shes') ||
    name.endsWith('ches') ||
    name.endsWith('xes') ||
    name.endsWith('zes')
  ) {
    return name.slice(0, -2)
  }
  if (name.endsWith('s') && !name.endsWith('ss') && name.length > 2) {
    return name.slice(0, -1)
  }
  return name
}
