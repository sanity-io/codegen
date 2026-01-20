/**
 * Reusable GROQ query fragments for composing larger queries
 * These fragments can be interpolated into groq template strings
 */

/**
 * Basic author fields
 * Includes: _id, _type, name, slug
 */
export const authorFragment = `
  _id,
  _type,
  name,
  slug
`

/**
 * Extended author fields with bio and image metadata
 * Includes: all basic fields + bio content and image with metadata
 */
export const authorDetailFragment = `
  _id,
  _type,
  name,
  slug,
  bio,
  image{
    asset->{
      _id,
      url,
      metadata{
        dimensions,
        lqip,
        palette
      }
    }
  }
`

/**
 * Post preview fields for listing views
 * Includes: _id, _type, title, slug, publishedAt, and excerpt from body
 */
export const postPreviewFragment = `
  _id,
  _type,
  title,
  slug,
  publishedAt,
  "excerpt": array::join(string::split(pt::text(body), "")[0..255], "") + "..."
`

/**
 * Full post fields without relationships
 * Includes: all post fields except author and categories
 */
export const postDetailFragment = `
  _id,
  _type,
  _createdAt,
  _updatedAt,
  title,
  slug,
  body,
  publishedAt,
  mainImage{
    asset->{
      _id,
      url,
      metadata{
        dimensions,
        palette,
        lqip
      }
    },
    crop,
    hotspot
  }
`

/**
 * Image asset with comprehensive metadata
 * Includes: asset reference with dimensions, palette, lqip, and urls
 */
export const imageFragment = `
  asset->{
    _id,
    url,
    originalFilename,
    extension,
    size,
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
        },
        darkMuted{
          background,
          foreground
        },
        vibrant{
          background,
          foreground
        }
      },
      lqip,
      hasAlpha,
      isOpaque
    }
  },
  crop,
  hotspot
`

/**
 * Basic category fields
 * Includes: _id, _type, title, description
 */
export const categoryFragment = `
  _id,
  _type,
  title,
  description
`
