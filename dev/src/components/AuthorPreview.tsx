import {useDocumentProjection} from '@sanity/sdk-react'

const authorProjection = '{name, slug, bio}'

export function AuthorPreview({documentId}: {documentId: string}) {
  const {data} = useDocumentProjection({
    documentId,
    documentType: 'author',
    projection: authorProjection,
  })

  return <div>{data.name}</div>
}

export function PostPreview({documentId}: {documentId: string}) {
  const {data} = useDocumentProjection({
    documentId,
    documentType: 'post',
    projection: '{title, slug, publishedAt}',
  })

  return <div>{data.title}</div>
}
