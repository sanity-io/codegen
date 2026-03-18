export default {
  // JavaScript and TypeScript files: run ESLint fix first, then oxfmt
  '*.{js,ts,mjs,cjs}': ['eslint --fix', 'oxfmt --no-error-on-unmatched-pattern'],

  // Markdown files: run oxfmt
  '*.md': ['oxfmt --no-error-on-unmatched-pattern'],
}
