/**
 * Inlined shared Sanity shapes for the Go generator. Each shape is gated by a
 * boolean in `UsedShared` so we don't emit dead code for types the schema never
 * references (transitive walk performed by emit.ts).
 *
 * Output strings are formatted to match the canonical `gofmt` style — tabs for
 * indentation, struct fields aligned in columns by the surrounding emitter.
 */
export interface UsedShared {
  asset: boolean
  document: boolean
  image: boolean
  reference: boolean
  slug: boolean
}

export function emptyUsedShared(): UsedShared {
  return {asset: false, document: false, image: false, reference: false, slug: false}
}

const REFERENCE_BLOCK = `// Reference is a Sanity reference to another document.
type Reference struct {
\tRef  string \`json:"_ref"\`
\tType string \`json:"_type"\`
\tWeak bool   \`json:"_weak,omitempty"\`
}`

const SLUG_BLOCK = `// Slug is a Sanity slug value.
type Slug struct {
\tCurrent string \`json:"current"\`
}`

const ASSET_BLOCK = `// Asset is a Sanity asset reference.
type Asset struct {
\tRef  string \`json:"_ref"\`
\tType string \`json:"_type"\`
}`

const IMAGE_BLOCK = `// Image is a Sanity image value with an asset reference and optional crop/hotspot.
type Image struct {
\tAsset   *Asset       \`json:"asset,omitempty"\`
\tHotspot *ImageHotspot \`json:"hotspot,omitempty"\`
\tCrop    *ImageCrop    \`json:"crop,omitempty"\`
}

type ImageHotspot struct {
\tX      float64 \`json:"x"\`
\tY      float64 \`json:"y"\`
\tHeight float64 \`json:"height"\`
\tWidth  float64 \`json:"width"\`
}

type ImageCrop struct {
\tTop    float64 \`json:"top"\`
\tBottom float64 \`json:"bottom"\`
\tLeft   float64 \`json:"left"\`
\tRight  float64 \`json:"right"\`
}`

const DOCUMENT_BLOCK = `// Document is the common header embedded in every Sanity document.
type Document struct {
\tID        string \`json:"_id"\`
\tType      string \`json:"_type"\`
\tRev       string \`json:"_rev,omitempty"\`
\tCreatedAt string \`json:"_createdAt,omitempty"\`
\tUpdatedAt string \`json:"_updatedAt,omitempty"\`
}`

/**
 * Returns the inlined shared-shape code blocks for the shapes that are actually
 * used by the schema, in a stable order. Returns an empty string when none are
 * needed.
 */
export function renderSharedShapes(used: UsedShared): string {
  const blocks: string[] = []
  if (used.document) blocks.push(DOCUMENT_BLOCK)
  if (used.reference) blocks.push(REFERENCE_BLOCK)
  if (used.slug) blocks.push(SLUG_BLOCK)
  if (used.asset) blocks.push(ASSET_BLOCK)
  if (used.image) blocks.push(IMAGE_BLOCK)
  if (blocks.length === 0) return ''
  return blocks.join('\n\n')
}
