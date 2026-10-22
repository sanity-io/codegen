# @sanity/codegen

Codegen toolkit for Sanity.io, used to generate Typescript types for a Sanity Schema & GROQ queries.

## Typed `client.fetch` results

With `overloadClientMethods` enabled (the default), the generated file ends with a query type map that registers every query it found, so `client.fetch(query)` in `@sanity/client`, and `sanityFetch({query})` in `next-sanity`, return the generated result type without a generic:

```ts
// Query TypeMap
declare global {
  interface SanityQueries {
    '*[_type == "post"]': PostsQueryResult
  }
}
// Lets @sanity/client releases that predate the global registry read it too
declare module '@sanity/client' {
  interface SanityQueries extends globalThis.SanityQueries {}
}
```

The two blocks serve different `@sanity/client` releases, and the same generated file works with all of them:

- The `declare global` block is the registry. `@sanity/client` releases that know about it read it directly, and because it is a global interface rather than a module augmentation, it does not depend on module resolution: it is seen whether or not `@sanity/client` is a direct dependency of the project that holds the generated file, however many copies of the client are installed (a copy nested inside `next-sanity` reads the same registry), and from every entry point, `@sanity/client/stega` included.
- The `declare module '@sanity/client'` block is a bridge for releases that only read the `SanityQueries` interface exported from `@sanity/client`, which is every release since 6.21.0. Interface merging unions the `extends` clauses of an interface's declarations, so the bridge makes that interface inherit the global registry. On releases that already inherit it, the bridge is a duplicate `extends` of the same type, which TypeScript accepts.

The bridge is the only line that resolves `@sanity/client`. When the client cannot be resolved from the generated file, TypeScript reports `TS2664: Invalid module name in augmentation` for it in a `.ts` file, while in a declaration file an augmentation whose module cannot be found is skipped silently. Pointing `generates` at a `.d.ts` path therefore keeps the file valid in such a layout, and the global registry still types the client that is installed.

The earlier output, a `declare module '@sanity/client'` block that carried the whole map, keeps working with every `@sanity/client` release that accepts the new one.

## Types per dataset

Pass `resource: {projectId, dataset}` to a generation run and the generated file also registers its schema and query result types under that resource, keyed `projectId.dataset`:

```ts
// Resource TypeMap: abc123.production
declare global {
  interface SanitySchemasByResource {
    'abc123.production': AllSanitySchemaTypes
  }
  interface SanityQueriesByResource {
    'abc123.production': {
      '*[_type == "post"]': PostsQueryResult
    }
  }
  interface SanityProjectionsByResource {
    'abc123.production': {
      post: {
        '{title}': PostTitleResult
      }
    }
  }
}
```

An app that reads more than one dataset generates one file per dataset, and the same query text then resolves to a different type for each. `@sanity/client` 8.7.0 and later declare these interfaces, and the App SDK's hooks read them. The key is the same string the App SDK uses for its runtime cache.

This block has no `declare module '@sanity/client'` bridge. The registries first shipped as globals, so no client release needs one, and without it the block never resolves `@sanity/client`. That matters when the client is only a dependency of another package, as with the App SDK under pnpm. The flat query type map's bridge still resolves it, so in that layout also set `overloadClientMethods: false` (it defaults to `true`), or point `generates` at a `.d.ts` path as described above.

The flat query type map above is still controlled by `overloadClientMethods`, independently. When generating more than one resource into one TypeScript program, set `overloadClientMethods: false` for all of them: each file would declare the same query text in `SanityQueries` with a different type, which TypeScript rejects. For the same reason, generate one file per resource. Two files registering the same resource conflict.

Without `resource`, the generated file is unchanged.

### Projections

Projections passed to the App SDK's `defineProjection`, imported from `@sanity/sdk` or `@sanity/sdk-react`, are typed too:

```ts
import {defineProjection} from '@sanity/sdk-react'

// Evaluated for `post` documents only
export const postTitle = defineProjection('post', '{title}')

// Evaluated for every document type in the schema
export const anyTitle = defineProjection('{title}')
```

Each projection is evaluated as `*[_type == TYPE][0]PROJECTION` for its document type, and its result type is the object without `null`, since the SDK only projects documents it has found. A projection without a document type is evaluated for every document type in the schema. Document types with the same result share one type alias; the others get an alias named after the document type, such as `AnyTitleAuthorResult`. Passing the document type keeps the generated file smaller.

With `resource` set, results are registered in `SanityProjectionsByResource` by document type and then by the exact projection text, which is what `useDocumentProjection` looks up. Without `resource`, only the result type aliases are generated. As with `defineQuery`, only calls assigned to a variable are found, and the arguments must be resolvable without running the code. With `resource` set, a projection naming a document type the schema does not have is skipped, because another dataset scanning the same files can have it. A name that is an object type in the schema, or any unknown name in a run without `resource`, is reported as an error.

`runTypegenGenerate` also accepts `extractedSchema`, a schema already in memory in the shape `sanity schema extract` writes, so a caller that fetched and compiled a schema does not have to write it to a temporary file first. The file then has no `// Source:` line naming a schema file, since there is none.

## Importing `.groq` files

Experimental and opt-in, for TypeScript 7.1 and later. A query kept in its own file can be imported as a typed query:

```groq
// postsBySearch.groq
*[_type == "post"] | score(
  boost(title match $searchQuery, 10),
  text::semanticSimilarity($searchQuery)
) | order(_score desc) [$start...$end] {
  _id,
  title,
  slug,
  "_score": _score
}
```

```ts
import postsBySearch from './postsBySearch.groq' with {type: 'text'}
import type {QueryParams, QueryResponse} from './postsBySearch.groq'

const posts = await client.fetch(postsBySearch, {searchQuery: 'foo', start: 0, end: 10})
//    ^? QueryResponse, with the params checked, no generic argument and no global registry

const params = {searchQuery: 'foo', start: 0, end: 10} satisfies QueryParams

function PostsList(props: {data: QueryResponse}) {}
```

The import attribute, `with {type: 'text'}`, is the standard way to import a file as its text (TC39 [import text](https://github.com/tc39/proposal-import-text), stage 3): at run time the default export is the file's content, a string, delivered by the runtime or bundler itself. TypeScript ignores the attribute and asks the content mapper for the module's type instead. A type-only import needs no attribute; a value import does, because it runs. Inline type specifiers work too: `import postsBySearch, {type QueryResponse} from './postsBySearch.groq' with {type: 'text'}`.

The module has three exports. The default export is the query string itself, typed as its own literal with the result and params types attached as optional phantom properties, so it is still assignable to `string` and goes anywhere a query string goes. The literal is the file's exact content, whitespace and trailing newline included, because that is what the text import evaluates to; GROQ does not mind. `QueryResponse` is the result type, evaluated as a `defineQuery` call is, so `[0]` is `T | null`. `QueryParams` is the object the `$` placeholders expect: a placeholder compared with a field takes the field's type, including string enums and arrays, `$x in field` takes the element type and `field in $xs` the array, `match` takes a string, slice bounds are numbers, and a placeholder the schema says nothing about is `unknown`, which still makes the key required. A query without placeholders has `QueryParams = Record<string, never>`.

```ts
// What `import postsBySearch from './postsBySearch.groq' with {type: 'text'}` resolves to
export type QueryResponse = Array<{
  _id: string
  title: string | null
  slug: Slug | null
  _score: null
}>
export type QueryParams = {searchQuery: string; start: number; end: number}
declare const query: '*[_type == "post"] | score(…\n' & {
  readonly __groqResult?: QueryResponse
  readonly __groqParams?: QueryParams
}
export default query
```

Nothing is declared globally and nothing is imported: no `SanityQueries` entry, no `declare module '@sanity/client'`. Two files with the same query text have the same type. `@sanity/client` reads the brand structurally, with `G extends {readonly __groqResult?: infer R}` for the result and the same property for the params ([sanity-io/client#1373](https://github.com/sanity-io/client/pull/1373)), so the two packages never import each other. The brand is exported from this package as `GroqQuery<Query, Result, Params>` for reference, with `GroqResult<Q>` and `GroqParams<Q>` to read it back. Client releases that predate the brand accept the import, since it is a string, and resolve to `any`; pass the type to them explicitly: `client.fetch<QueryResponse>(postsBySearch, params)`.

### Setup

This needs TypeScript 7.1 beta or later, the first release with [content mappers](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/), and Node 22.12 or later, or Bun.

```sh
npm install -D @sanity/codegen typescript@beta
```

An app that runs on Node under the preload below, rather than as a bundle or on a Node with native text imports, loads its `.groq` files when it runs, so it installs `@sanity/codegen` as a dependency: `npm install @sanity/codegen`.

Name the package in `tsconfig.json`, next to `compilerOptions`, with the extension it should own and the schema to type against, and type-check with `--runExternalCode`, the flag that lets `tsc` run content mappers. The mapper then types every `.groq` import from the live file, with nothing written to disk, and reports a GROQ syntax error at the `.groq` file. The feature is this mapper; there is no generated declaration file and nothing for earlier TypeScript releases.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    /* ... */
  },
  "contentMappers": [
    {
      "package": "@sanity/codegen",
      "extensions": [".groq"],
      "options": {"schema": "./schema.json"},
    },
  ],
}
```

```jsonc
// package.json
{
  "scripts": {
    "typecheck": "tsc --noEmit --runExternalCode",
  },
}
```

At run time the import attribute does the work: `import query from './posts.groq' with {type: 'text'}` makes the runtime or bundler deliver the file as a string, which most of them do on their own. Where one does not, one line fills in. None of these runs the type generator, and each delivers the file as it is, which is what the mapper types.

| Runtime or bundler                            | `with {type: 'text'}`                    | Setup                                                                                                                       |
| --------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Node 26.5 and later                           | behind `--experimental-import-text`      | the flag, or the preload below                                                                                              |
| Node 22.12 and later                          | no                                       | `node --import @sanity/codegen/register main.ts`                                                                            |
| Bun                                           | yes                                      | nothing                                                                                                                     |
| Deno                                          | yes                                      | nothing; `deno check` types the import as `string`, since Deno's TypeScript has no content mappers                          |
| esbuild, `Bun.build`                          | yes                                      | nothing                                                                                                                     |
| webpack 5.102 and later, Rspack 1.7 and later | yes, as `asset/source`                   | nothing                                                                                                                     |
| webpack before 5.102                          | no                                       | `{test: /\.groq$/, type: 'asset/source'}` in `module.rules`                                                                 |
| Rolldown                                      | with `moduleTypes: {'.groq': 'text'}`    | that option                                                                                                                 |
| Vite, Vitest, Rollup                          | not in Vite's dev server                 | `import groqFiles from '@sanity/codegen/vite'`, then `groqFiles()` in `plugins`                                             |
| Sanity Studio, App SDK apps                   | as Vite                                  | the same plugin, in `vite: {plugins: [groqFiles()]}` of `sanity.cli.ts`                                                     |
| Next.js 16.3 and later                        | yes under Turbopack; its webpack is 5.98 | `import {withGroqFiles} from '@sanity/codegen/next'`, then `export default withGroqFiles(nextConfig)` (below)               |
| Jest                                          | rejected by Jest's ES module loader      | `'@sanity/codegen/jest'` in `transform`, for `'\\.groq$'`, with tests compiled to CommonJS, where Babel drops the attribute |

`withGroqFiles` adds the `asset/source` rule for the webpack Next bundles and takes over the type check `next build` runs: Next runs the project's own `tsc` for it, but without `--runExternalCode`, which TypeScript takes from the command line only, so that check cannot start the mapper and fails on every `.groq` import. The wrapper turns Next's check off and runs the same check with the flag in `compiler.runAfterProductionCompile`, after the compile under either bundler; on a first build it runs `next typegen` first, since Next writes `next-env.d.ts` only later. A project that set `typescript.ignoreBuildErrors` itself gets no check.

In VS Code or Cursor, install the TypeScript 7 extension, `TypeScriptTeam.native-preview`, and point it at the project's TypeScript, since the extension bundles 7.0:

```jsonc
// .vscode/settings.json
{
  "js/ts.experimental.useTsgo": true,
  "js/ts.tsdk.path": "./node_modules/typescript",
}
```

Then trust the workspace, and allow the extension to use the workspace's TypeScript when it asks; editors ask for `--runExternalCode` that way.

### The schema

The tsconfig is the only place the mapper is configured. `schema` is the file `sanity schema extract` writes, relative to the tsconfig, and is required: the mapper reads no other configuration, and an entry without it is reported against the entry. The schema file is watched, so extracting it again retypes the imports. A file that cannot be typed, because the query does not parse or the schema file is missing, still resolves, with `unknown` for what could not be inferred, alongside the diagnostic that says why.

A codebase that queries more than one project or dataset has one schema per folder. TypeScript registers a content mapper by file extension alone, with no folder on the entry, and rejects two entries for `.groq` with TS18067, so the folders are scoped inside the one entry, with `schemas`: each item pairs one or more folders with the schema for the `.groq` files under them. A file is typed against the schema of the longest folder that contains it, and against `schema` when none does; without a `schema`, a file outside every folder gets a diagnostic saying so. Folders, rather than a second file ending such as `.shop.groq`, so that a query file is named for what it is wherever it lives.

```jsonc
{
  "contentMappers": [
    {
      "package": "@sanity/codegen",
      "extensions": [".groq"],
      "options": {
        "schemas": [
          {"include": "src/queries/blog", "schema": "schemas/blog.json"},
          {"include": ["src/queries/shop", "src/queries/checkout"], "schema": "schemas/shop.json"},
        ],
      },
    },
  ],
}
```

The folders also make for short import paths. A `package.json` `imports` entry names them once:

```jsonc
// package.json
{
  "imports": {
    "#queries/*": "./src/queries/*",
  },
}
```

```ts
import posts from '#queries/blog/posts.groq' with {type: 'text'}
import products from '#queries/shop/products.groq' with {type: 'text'}
```

TypeScript resolves the alias to the file before asking the mapper, so each import is typed against its folder's schema, and Node, Bun, Deno and the bundlers resolve `imports` on their own.

The mapper is also exported as `@sanity/codegen/content-mapper`, as `ContentMapper`, for a host that wants to drive it in-process.

Two things are not inferred: a comparison against `^` is `unknown`, because the probe that resolves field types does not reproduce the parent scope, and groq-js does not yet model `score()`, so `_score` is `null` in a result and `[_score > 0]` empties it.
