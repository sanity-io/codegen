export default {
  '*.md': ['oxfmt --no-error-on-unmatched-pattern'],
  '*.{js,ts,mjs,cjs}': ['eslint --fix', 'oxfmt --no-error-on-unmatched-pattern'],
}
