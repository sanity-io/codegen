export default {
  bin: 'sanity',
  commands: './dist/commands',
  dirname: 'sanity-typegen',
  topics: {
    typegen: {
      description: 'Generate TypeScript types for schema and GROQ',
    },
  },
  topicSeparator: ' ',
}
