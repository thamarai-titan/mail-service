/**
 * `Content-Disposition: attachment` with the original name: an ASCII fallback in `filename` and
 * the exact name in `filename*` (RFC 6266 / RFC 8187), so quotes or non-Latin names cannot
 * break out of the header.
 */
export function attachmentDisposition(filename: string): string {
  const fallback =
    filename
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\%;]/g, '_')
      .trim() || 'attachment';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/** The declared type when it is a plain `type/subtype`, otherwise a generic binary type. */
export function safeContentType(contentType: string): string {
  return MIME_TYPE.test(contentType) ? contentType : 'application/octet-stream';
}
