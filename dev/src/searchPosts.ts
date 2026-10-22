/**
 * A `.groq` file imported as a typed query.
 *
 * The default export is the file's text, which the runtime delivers because of the import
 * attribute, typed so its result and params travel with it. TypeScript 7.1 types the import
 * through the content mapper registered in `tsconfig.json`: `pnpm typecheck` runs
 * `tsc --runExternalCode`.
 */

import {createClient} from '@sanity/client'

import postsBySearch, {
  type QueryParams,
  type QueryResponse,
} from './queries/postsBySearch.groq' with {type: 'text'}

const client = createClient({
  apiVersion: '2026-10-22',
  dataset: 'test',
  projectId: 'ppsg7ml5',
  useCdn: true,
})

const PAGE_SIZE = 10

/**
 * With an `@sanity/client` that reads the brand (sanity-io/client#1373 and later), `fetch`
 * resolves to `QueryResponse` and checks the params, with no generic argument and no entry in
 * `SanityQueries`. Older releases accept the call, since the query is a string, and return `any`.
 */
export function searchPosts(searchQuery: string, page = 0): Promise<QueryResponse> {
  const params = {
    end: (page + 1) * PAGE_SIZE,
    searchQuery,
    start: page * PAGE_SIZE,
  } satisfies QueryParams
  return client.fetch(postsBySearch, params)
}

export function renderPosts(posts: QueryResponse): string[] {
  return posts.map((post) => `${post.title ?? 'Untitled'} (/${post.slug?.current ?? post._id})`)
}

// The query is still a plain string.
export const postsBySearchText: string = postsBySearch
