/**
 * GROQ queries for Post documents
 * Demonstrates comprehensive query patterns including relationships, ordering, pagination, and complex projections
 */

import groq, {defineQuery} from 'groq'

import {
  authorFragment,
  categoryFragment,
  imageFragment,
  postDetailFragment,
  postPreviewFragment,
} from './fragments'

/**
 * Get all posts with basic fields
 * @returns Array of all post documents
 */
export const allPostsQuery = defineQuery(`*[_type == "post"]{
  _id,
  title,
  slug,
  publishedAt
}`)

/**
 * Get a single post by its document ID
 * @param id - The _id of the post document
 * @returns Single post document or null
 */
export const postByIdQuery = defineQuery(`*[_type == "post" && _id == $id][0]{
  _id,
  _type,
  title,
  slug,
  body,
  publishedAt,
  mainImage
}`)

/**
 * Get a single post by its slug
 * @param slug - The slug.current value of the post
 * @returns Single post document or null
 */
export const postBySlugQuery = groq`
  *[_type == "post" && slug.current == $slug][0]{
    _id,
    _type,
    title,
    slug,
    body,
    publishedAt,
    mainImage
  }
`

/**
 * Get recent posts ordered by publication date
 * @param limit - Maximum number of posts to return (default: 10)
 * @returns Array of recent posts
 */
export const recentPostsQuery = defineQuery(`
  *[_type == "post" && defined(publishedAt)] | order(publishedAt desc)[0...$limit]{
    _id,
    title,
    slug,
    publishedAt,
    "excerpt": array::join(string::split(pt::text(body), "")[0..200], "") + "..."
  }
`)

/**
 * Get post with dereferenced author details
 * Demonstrates single reference dereferencing
 * @param slug - The slug.current value of the post
 * @returns Post with complete author information
 */
export const postWithAuthorQuery = groq`
  *[_type == "post" && slug.current == $slug][0]{
    _id,
    title,
    slug,
    publishedAt,
    author->{
      ${authorFragment},
      image{
        asset->{
          url
        }
      }
    }
  }
`

/**
 * Get post with dereferenced categories array
 * Demonstrates array reference dereferencing
 * @param postId - The _id of the post
 * @returns Post with complete category information
 */
export const postWithCategoriesQuery = groq`
  *[_type == "post" && _id == $postId][0]{
    _id,
    title,
    slug,
    categories[]->{
      ${categoryFragment}
    }
  }
`

/**
 * Get posts by a specific author
 * @param authorId - The _id of the author
 * @returns Array of posts by the specified author
 */
export const postsByAuthorQuery = defineQuery(`
  *[_type == "post" && author._ref == $authorId] | order(publishedAt desc){
    _id,
    title,
    slug,
    publishedAt,
    "excerpt": array::join(string::split(pt::text(body), "")[0..150], "") + "..."
  }
`)

/**
 * Get posts in a specific category
 * Demonstrates filtering within array references
 * @param categoryId - The _id of the category
 * @returns Array of posts in the specified category
 */
export const postsByCategoryQuery = defineQuery(`
  *[_type == "post" && $categoryId in categories[]._ref] | order(publishedAt desc){
    _id,
    title,
    slug,
    publishedAt
  }
`)

/**
 * Get complete post with all relationships dereferenced
 * Demonstrates comprehensive dereferencing of author, categories, and image assets
 * @param slug - The slug.current value of the post
 * @returns Complete post with all related data
 */
export const postDetailQuery = groq`
  *[_type == "post" && slug.current == $slug][0]{
    ${postDetailFragment},
    author->{
      _id,
      name,
      slug,
      image{
        asset->{
          url
        }
      }
    },
    categories[]->{
      ${categoryFragment}
    },
    mainImage{
      ${imageFragment}
    }
  }
`

/**
 * Get paginated posts
 * Demonstrates slicing with parameters for pagination
 * @param from - Starting index (0-based)
 * @param to - Ending index (inclusive)
 * @returns Slice of posts for the requested page
 */
export const paginatedPostsQuery = groq`
  *[_type == "post" && defined(publishedAt)] | order(publishedAt desc)[$from...$to]{
    ${postPreviewFragment},
    author->{
      name,
      slug
    }
  }
`

/**
 * Get posts with generated excerpts from body content
 * Demonstrates Portable Text extraction using pt::text()
 * @returns Array of posts with text excerpts
 */
export const postsWithExcerptQuery = groq`
  *[_type == "post" && defined(body)] | order(publishedAt desc)[0..9]{
    _id,
    title,
    slug,
    publishedAt,
    "excerpt": array::join(string::split(pt::text(body), "")[0..200], "") + "...",
    "fullText": pt::text(body),
    "wordCount": length(string::split(pt::text(body), " "))
  }
`

/**
 * Search posts by title
 * Demonstrates text search/filtering
 * @param searchTerm - The search term to match against post titles
 * @returns Array of matching posts
 */
export const searchPostsQuery = defineQuery(`
  *[_type == "post" && title match $searchTerm]{
    _id,
    title,
    slug,
    publishedAt,
    "excerpt": array::join(string::split(pt::text(body), "")[0..150], "") + "..."
  }
`)

/**
 * Get posts within a date range
 * Demonstrates date filtering with range constraints
 * @param startDate - Start date in ISO format (inclusive)
 * @param endDate - End date in ISO format (inclusive)
 * @returns Array of posts published within the date range
 */
export const postsByDateRangeQuery = defineQuery(`
  *[_type == "post" && publishedAt >= $startDate && publishedAt <= $endDate] | order(publishedAt desc){
    _id,
    title,
    slug,
    publishedAt
  }
`)

/**
 * Get post with related posts (same categories)
 * Demonstrates join-like patterns and complex filtering
 * @param postId - The _id of the current post
 * @returns Post with array of related posts
 */
export const postWithRelatedQuery = groq`
  *[_type == "post" && _id == $postId][0]{
    _id,
    title,
    slug,
    categories[]->{
      _id,
      title
    },
    "relatedPosts": *[
      _type == "post" &&
      _id != $postId &&
      count((categories[]._ref)[@ in ^.^.categories[]._ref]) > 0
    ][0..5]{
      _id,
      title,
      slug,
      publishedAt,
      "sharedCategories": categories[_ref in ^.^.categories[]._ref]->{
        title
      }
    }
  }
`

/**
 * Get featured posts with custom logic
 * Demonstrates conditional logic and coalesce for fallbacks
 * @returns Array of featured posts (posts with mainImage and recent publishedAt)
 */
export const featuredPostsQuery = groq`
  *[
    _type == "post" &&
    defined(mainImage.asset) &&
    defined(publishedAt) &&
    publishedAt > (now() - 60*60*24*30)
  ] | order(publishedAt desc)[0..5]{
    _id,
    title,
    slug,
    publishedAt,
    mainImage{
      asset->{
        url,
        metadata{
          dimensions,
          lqip
        }
      }
    },
    author->{
      name,
      slug
    },
    "categoryTitles": categories[]->title
  }
`
