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
