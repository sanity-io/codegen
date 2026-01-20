import {resolve} from 'node:path'

import {includeIgnoreFile} from '@eslint/compat'
import eslintConfig from '@sanity/eslint-config-cli'
import {defineConfig} from 'eslint/config'

export default defineConfig([
  includeIgnoreFile(resolve(import.meta.dirname, '.gitignore')),
  {
    ignores: ['dev/**/sanity.types.ts'],
  },
  ...eslintConfig,
])
