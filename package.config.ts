import {defineConfig} from '@sanity/pkg-utils'

export default defineConfig({
  define: {
    __DEV__: false,
  },
  dist: 'lib',
  extract: {
    // We already check types with `check:types` scripts
    checkTypes: false,

    customTags: [
      {
        allowMultiple: true,
        name: 'hidden',
        syntaxKind: 'block',
      },
      {
        allowMultiple: true,
        name: 'todo',
        syntaxKind: 'block',
      },
    ],
    rules: {
      'ae-incompatible-release-tags': 'off',
      'ae-internal-missing-underscore': 'off',
      'ae-missing-release-tag': 'off',
    },
  },
  strictOptions: {
    noImplicitBrowsersList: 'off',
    noImplicitSideEffects: 'error',
  },
  tsconfig: 'tsconfig.lib.json',
})
