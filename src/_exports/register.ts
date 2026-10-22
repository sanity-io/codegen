// The preload that lets `import query from './posts.groq' with {type: 'text'}` run on Node:
//
//   node --import @sanity/codegen/register main.ts
//
// Node 26.5 and later can do it alone with `--experimental-import-text`; Bun and Deno need no
// preload at all. Types come from the content mapper, not from here.
import * as nodeModule from 'node:module'

import {load} from '../groqFiles/nodeHooks.js'

/* eslint-disable n/no-unsupported-features/node-builtins -- `registerHooks` is a release candidate since Node 24 and guarded; `register` is stable for ESM, the case here */
// `registerHooks` runs in-thread, and reaches `require()` too; Node before 22.15 has only the
// hooks that run on their own thread.
const {register, registerHooks} = nodeModule as Partial<typeof nodeModule>
if (registerHooks) {
  registerHooks({load})
} else {
  register!('../groqFiles/nodeHooks.js', import.meta.url)
}
