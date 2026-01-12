import groq from 'groq'
// @ts-expect-error - this is a test error
// eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
const postQuery = groq`*[_type == "author"]`
