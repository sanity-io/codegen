/**
 * Fully-qualified class names shipped by `sanity-io/sanity-php` under the root
 * `Sanity\` namespace. The PHP generator refuses to emit a class whose
 * fully-qualified name matches an entry in this list (R11). The user can
 * resolve a collision by overriding `typegen.php.namespace`.
 *
 * Sourced from the public surface of `sanity-io/sanity-php` (PSR-4 root
 * `Sanity\`).
 */
export const SANITY_PHP_RESERVED_CLASSES: ReadonlyArray<string> = [
  String.raw`Sanity\Client`,
  String.raw`Sanity\ClientConfig`,
  String.raw`Sanity\BlockContent`,
  String.raw`Sanity\Patch`,
  String.raw`Sanity\Transaction`,
  String.raw`Sanity\Selection`,
  String.raw`Sanity\Exception\BaseException`,
  String.raw`Sanity\Exception\ClientException`,
  String.raw`Sanity\Exception\ConfigException`,
  String.raw`Sanity\Exception\InvalidArgumentException`,
  String.raw`Sanity\Exception\ServerException`,
  String.raw`Sanity\Util\DocumentPropertyAsserter`,
]
