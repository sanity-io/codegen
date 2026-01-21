export default {
  bin: 'sanity',
  commands: './dist/commands',
  dirname: 'sanity-typegen',
  plugins: ['@oclif/plugin-help'],
  topics: {
    typegen: {
      description: 'Beta: Generate TypeScript types for schema and GROQ',
    },
  },
  topicSeparator: ' ',
}
