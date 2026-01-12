import {resolve} from 'node:path'

import {includeIgnoreFile} from '@eslint/compat'
import eslintConfig from '@sanity/eslint-config-cli'
import {defineConfig} from 'eslint/config'

export default defineConfig([
  includeIgnoreFile(resolve(import.meta.dirname, '.gitignore')),
  ...eslintConfig,
  {
    files: ['test/__fixtures__/**/*.ts'],
    rules: {
      'import/no-unresolved': 'off',
    },
  },
])
