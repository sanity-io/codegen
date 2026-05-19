export interface UsedSharedShapes {
  asset: boolean
  document: boolean
  image: boolean
  reference: boolean
  slug: boolean
}

/**
 * Return the inlined shared-shape class snippets that should appear in the
 * emitted file, gated by `used`. Only the shapes referenced (transitively)
 * by the schema are emitted — no dead code.
 */
export function emitSharedShapes(used: UsedSharedShapes): string {
  const blocks: string[] = []

  if (used.reference) {
    blocks.push(`final readonly class Reference {
    public function __construct(
        public string $_ref,
        public string $_type,
        public ?bool $_weak = null,
    ) {}

    public static function fromArray(array $data): self {
        return new self(
            _ref: $data['_ref'],
            _type: $data['_type'],
            _weak: $data['_weak'] ?? null,
        );
    }
}`)
  }

  if (used.slug) {
    blocks.push(`final readonly class Slug {
    public function __construct(
        public string $current,
        public ?string $_type = null,
    ) {}

    public static function fromArray(array $data): self {
        return new self(
            current: $data['current'],
            _type: $data['_type'] ?? null,
        );
    }
}`)
  }

  if (used.asset) {
    blocks.push(`final readonly class Asset {
    public function __construct(
        public string $_ref,
        public string $_type,
        public ?bool $_weak = null,
    ) {}

    public static function fromArray(array $data): self {
        return new self(
            _ref: $data['_ref'],
            _type: $data['_type'],
            _weak: $data['_weak'] ?? null,
        );
    }
}`)
  }

  if (used.image) {
    blocks.push(`final readonly class Image {
    public function __construct(
        public ?Asset $asset = null,
        public ?array $crop = null,
        public ?array $hotspot = null,
    ) {}

    public static function fromArray(array $data): self {
        return new self(
            asset: isset($data['asset']) ? Asset::fromArray($data['asset']) : null,
            crop: $data['crop'] ?? null,
            hotspot: $data['hotspot'] ?? null,
        );
    }
}`)
  }

  if (used.document) {
    blocks.push(`abstract readonly class Document {
    public function __construct(
        public string $_id,
        public string $_type,
        public ?string $_rev = null,
        public ?string $_createdAt = null,
        public ?string $_updatedAt = null,
    ) {}
}`)
  }

  return blocks.join('\n\n')
}
