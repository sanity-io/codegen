import groq from 'groq'
// @ts-expect-error - this is a test error
const postQuery = groq`*[_type == "author"]`
