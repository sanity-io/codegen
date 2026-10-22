// eslint-disable-next-line import-x/no-extraneous-dependencies -- a build-time plugin, a devDependency as in any project
import groqFiles from '@sanity/codegen/vite'
import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  // `sanity dev` and `sanity build` bundle with Vite; this makes a `.groq` import evaluate to its text.
  vite: {plugins: [groqFiles()]},
})
