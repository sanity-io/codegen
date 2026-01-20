/**
 * GROQ queries for Author documents
 * Demonstrates various query patterns from basic filtering to complex projections
 */

import groq, {defineQuery} from 'groq'

import {authorDetailFragment} from './fragments'

/**
 * Get all authors with basic fields
 * @returns Array of all author documents
 */
export const allAuthorsQuery = groq`*[_type == "author"]{
  _id,
  name,
  slug
}`

/**
 * Get a single author by their document ID
 * @param id - The _id of the author document
 * @returns Single author document or null
 */
export const authorByIdQuery = defineQuery(`*[_type == "author" && _id == $id][0]{
  _id,
  _type,
  name,
  slug,
  image,
  bio
}`)

/**
 * Get a single author by their slug
 * @param slug - The slug.current value of the author
 * @returns Single author document or null
 */
export const authorBySlugQuery = groq`
  *[_type == "author" && slug.current == $slug][0]{
    _id,
    _type,
    name,
    slug,
    image,
    bio
  }
`

/**
 * Get author with dereferenced image asset and metadata
 * Demonstrates how to dereference image assets and access nested metadata
 * @returns Single author with complete image information
 */
export const authorWithImageQuery = defineQuery(`
  *[_type == "author"][0]{
    _id,
    name,
    slug,
    image{
      asset->{
        _id,
        url,
        originalFilename,
        metadata{
          dimensions{
            width,
            height,
            aspectRatio
          },
          palette{
            dominant{
              background,
              foreground
            }
          },
          lqip
        }
      },
      crop,
      hotspot
    }
  }
`)

/**
 * Get author with bio content
 * Useful for displaying author profiles with their biographical information
 * @param slug - The slug.current value of the author
 * @returns Author with full bio blockContent
 */
export const authorWithBioQuery = groq`
  *[_type == "author" && slug.current == $slug][0]{
    _id,
    _type,
    name,
    slug,
    bio[]{
      ...,
      _type == "block" => {
        ...,
        children[]{
          ...
        }
      }
    }
  }
`

/**
 * Get all authors with a count of their published posts
 * Demonstrates aggregation using count() function
 * @returns Array of authors with post counts
 */
export const authorsWithPostCountQuery = defineQuery(`
  *[_type == "author"]{
    _id,
    name,
    slug,
    "postCount": count(*[_type == "post" && author._ref == ^._id])
  } | order(postCount desc)
`)

/**
 * Get author with their 5 most recent posts
 * Demonstrates nested queries and ordering
 * @param authorId - The _id of the author
 * @returns Author with array of their recent posts
 */
export const authorWithRecentPostsQuery = groq`
  *[_type == "author" && _id == $authorId][0]{
    _id,
    name,
    slug,
    image,
    "recentPosts": *[_type == "post" && author._ref == ^._id] | order(publishedAt desc)[0..4]{
      _id,
      title,
      slug,
      publishedAt,
      "excerpt": array::join(string::split(pt::text(body), "")[0..150], "") + "..."
    }
  }
`

/**
 * Get complete author profile using fragments
 * Demonstrates fragment composition and complex projections
 * @param slug - The slug.current value of the author
 * @returns Complete author profile with all details and post count
 */
export const authorDetailQuery = groq`
  *[_type == "author" && slug.current == $slug][0]{
    ${authorDetailFragment},
    "postCount": count(*[_type == "post" && author._ref == ^._id]),
    "posts": *[_type == "post" && author._ref == ^._id] | order(publishedAt desc){
      _id,
      title,
      slug,
      publishedAt
    }
  }
`
