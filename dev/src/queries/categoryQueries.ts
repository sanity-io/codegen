/**
 * GROQ queries for Category documents
 * Demonstrates reverse lookups, aggregations, and filtering patterns
 */

import groq, {defineQuery} from 'groq'

import {categoryFragment, postPreviewFragment} from './fragments'

/**
 * Get all categories
 * @returns Array of all category documents
 */
export const allCategoriesQuery = defineQuery(`*[_type == "category"]{
  _id,
  title,
  description
}`)

/**
 * Get a single category by its document ID
 * @param id - The _id of the category document
 * @returns Single category document or null
 */
export const categoryByIdQuery = defineQuery(`*[_type == "category" && _id == $id][0]{
  _id,
  _type,
  title,
  description
}`)

/**
 * Get category with count of posts in that category
 * Demonstrates aggregation using count() in projection
 * @param categoryId - The _id of the category
 * @returns Category with post count
 */
export const categoryWithPostCountQuery = groq`
  *[_type == "category" && _id == $categoryId][0]{
    ${categoryFragment},
    "postCount": count(*[_type == "post" && $categoryId in categories[]._ref])
  }
`

/**
 * Get category with all posts that reference it
 * Demonstrates reverse lookup pattern
 * @param categoryId - The _id of the category
 * @returns Category with array of posts
 */
export const categoryWithPostsQuery = groq`
  *[_type == "category" && _id == $categoryId][0]{
    ${categoryFragment},
    "posts": *[_type == "post" && $categoryId in categories[]._ref] | order(publishedAt desc){
      _id,
      title,
      slug,
      publishedAt,
      author->{
        name,
        slug
      }
    }
  }
`

/**
 * Get category with recent posts
 * Demonstrates reverse lookup with ordering and limiting
 * @param slug - The slug of the category
 * @param limit - Maximum number of posts to return (default: 5)
 * @returns Category with limited array of recent posts
 */
export const categoryWithRecentPostsQuery = groq`
  *[_type == "category" && _id == $categoryId][0]{
    _id,
    title,
    description,
    "recentPosts": *[_type == "post" && ^._id in categories[]._ref] | order(publishedAt desc)[0...$limit]{
      ${postPreviewFragment},
      author->{
        name,
        slug
      }
    }
  }
`

/**
 * Get popular categories ordered by post count
 * Demonstrates aggregation and ordering by computed values
 * @returns Array of categories sorted by post count (descending)
 */
export const popularCategoriesQuery = groq`
  *[_type == "category"]{
    _id,
    title,
    description,
    "postCount": count(*[_type == "post" && ^._id in categories[]._ref])
  } | order(postCount desc)
`

/**
 * Get categories that have descriptions
 * Demonstrates filtering with existence checks
 * @returns Array of categories with descriptions
 */
export const categoriesWithDescriptionQuery = defineQuery(`
  *[_type == "category" && defined(description)]{
    _id,
    title,
    description,
    "postCount": count(*[_type == "post" && ^._id in categories[]._ref])
  }
`)

/**
 * Get all categories with their post counts and recent post
 * Demonstrates complex projections with multiple computed fields
 * @returns Array of categories with counts and preview of latest post
 */
export const categoriesWithStatsQuery = groq`
  *[_type == "category"]{
    ${categoryFragment},
    "postCount": count(*[_type == "post" && ^._id in categories[]._ref]),
    "latestPost": *[_type == "post" && ^._id in categories[]._ref] | order(publishedAt desc)[0]{
      title,
      slug,
      publishedAt
    }
  } | order(postCount desc)
`
