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
