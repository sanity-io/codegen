# Polyglot TypeGen fixtures

Shared test fixtures for the per-language generators under `src/polyglot/<language>/`.

## `kitchen-sink-schema.json`

A synthetic Sanity `SchemaType` JSON that exercises every code path the four
language generators (TypeScript, Go, PHP, Swift) must handle:

- ≥3 document types
- Named object types
- Primitives: `string`, `number`, `boolean`, `datetime`, `slug`, `url`, `text`
- Arrays — homogeneous and union-of-types
- References between documents
- Optional fields
- Field names colliding with reserved keywords per language
  (Go `type`, PHP `class`, Swift `func`)

Populated by T011 in `specs/001-polyglot-typegen/tasks.md`. The placeholder `{}`
exists so the directory is committable before T011 lands.

## Loaders

`loadPenguinSchema.ts` (added in T012) wraps the local
`~/programming/sanity/penguin/schema.json` behind a `POLYGLOT_TYPEGEN_PENGUIN=1`
env flag so contributors without the penguin checkout can still run `pnpm test`.

## Determinism

Every generator must be deterministic: same `(schema, config)` → byte-identical
output. The snapshot suites under each language's `__tests__/` are the day-to-day
correctness signal; toolchain integration tests (`go build`, `php -l`,
`swift build`, `tsc --noEmit`) are the SC-003 guard.
