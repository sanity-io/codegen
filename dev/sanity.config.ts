import {defineArrayMember, defineConfig, defineField, defineType} from 'sanity'
import {structureTool} from 'sanity/structure'

const post = defineType({
  name: 'post',
  title: 'Post',
  type: 'document',

  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
    }),
    defineField({
      name: 'slug',
      options: {
        maxLength: 96,
        source: 'title',
      },
      title: 'Slug',
      type: 'slug',
    }),
    defineField({
      name: 'author',
      title: 'Author',
      to: {type: 'author'},
      type: 'reference',
    }),
    defineField({
      name: 'mainImage',
      options: {
        hotspot: true,
      },
      title: 'Main image',
      type: 'image',
    }),
    defineField({
      name: 'categories',
      of: [{to: {type: 'category'}, type: 'reference'}],
      title: 'Categories',
      type: 'array',
    }),
    defineField({
      name: 'publishedAt',
      title: 'Published at',
      type: 'datetime',
    }),
    defineField({
      name: 'body',
      title: 'Body',
      type: 'blockContent',
    }),
  ],

  preview: {
    select: {
      author: 'author.name',
      media: 'mainImage',
      title: 'title',
    },

    prepare(selection) {
      const {author} = selection
      return {...selection, subtitle: author && `by ${author}`}
    },
  },
})

const author = defineType({
  name: 'author',
  title: 'Author',
  type: 'document',

  fields: [
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
    }),
    defineField({
      name: 'slug',
      options: {
        maxLength: 96,
        source: 'name',
      },
      title: 'Slug',
      type: 'slug',
    }),
    defineField({
      name: 'image',
      options: {
        hotspot: true,
      },
      title: 'Image',
      type: 'image',
    }),
    defineField({
      name: 'bio',
      of: [
        {
          lists: [],
          styles: [{title: 'Normal', value: 'normal'}],
          title: 'Block',
          type: 'block',
        },
      ],
      title: 'Bio',
      type: 'array',
    }),
  ],

  preview: {
    select: {
      media: 'image',
      title: 'name',
    },
  },
})

const category = defineType({
  name: 'category',
  title: 'Category',
  type: 'document',

  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
    }),
  ],
})

/**
 * This is the schema definition for the rich text fields used for
 * for this blog studio. When you import it in schemas.js it can be
 * reused in other parts of the studio with:
 *
 * ```ts
 *  {
 *    name: 'someName',
 *    title: 'Some title',
 *    type: 'blockContent'
 *  }
 * ```
 */
const blockContent = defineType({
  name: 'blockContent',
  title: 'Block Content',
  type: 'array',

  of: [
    defineArrayMember({
      lists: [{title: 'Bullet', value: 'bullet'}],
      // Marks let you mark up inline text in the block editor.
      marks: {
        // Annotations can be any object structure – e.g. a link or a footnote.
        annotations: [
          {
            fields: [
              {
                name: 'href',
                title: 'URL',
                type: 'url',
              },
            ],
            name: 'link',
            title: 'URL',
            type: 'object',
          },
        ],
        // Decorators usually describe a single property – e.g. a typographic
        // preference or highlighting by editors.
        decorators: [
          {title: 'Strong', value: 'strong'},
          {title: 'Emphasis', value: 'em'},
        ],
      },
      // Styles let you set what your user can mark up blocks with. These
      // correspond with HTML tags, but you can set any title or value
      // you want and decide how you want to deal with it where you want to
      // use your content.
      styles: [
        {title: 'Normal', value: 'normal'},
        {title: 'H1', value: 'h1'},
        {title: 'H2', value: 'h2'},
        {title: 'H3', value: 'h3'},
        {title: 'H4', value: 'h4'},
        {title: 'Quote', value: 'blockquote'},
      ],
      title: 'Block',
      type: 'block',
    }),
    // You can add additional types here. Note that you can't use
    // primitive types such as 'string' and 'number' in the same array
    // as a block type.
    defineArrayMember({
      options: {hotspot: true},
      type: 'image',
    }),
  ],
})

export default defineConfig({
  title: 'Basic Studio',

  dataset: 'test',
  projectId: 'ppsg7ml5',

  plugins: [structureTool()],

  schema: {
    types: [post, author, category, blockContent],
  },
})
