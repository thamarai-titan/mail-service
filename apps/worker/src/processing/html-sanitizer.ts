import sanitizeHtml from 'sanitize-html';

/**
 * Allowlist for received HTML (README W2). Keeps the layout tags and inline styles mail relies
 * on and drops scripts, forms, frames, `<style>` blocks and event handlers. The dashboard adds
 * a sandboxed iframe and a CSP on top, so this is the first of three layers, not the only one.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'center', 'font'],
  allowedAttributes: {
    '*': [
      'style',
      'align',
      'valign',
      'width',
      'height',
      'bgcolor',
      'border',
      'cellpadding',
      'cellspacing',
      'colspan',
      'rowspan',
      'dir',
      'lang',
      'title',
    ],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt'],
    font: ['color', 'face', 'size'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // Inline images arrive as data: URIs: the parser turns cid: references into them.
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  transformTags: {
    // Links open outside the frame and send no referrer or opener.
    a: sanitizeHtml.simpleTransform('a', {
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
    }),
  },
};

/** Sanitized HTML, or null when nothing visible is left. */
export function sanitizeEmailHtml(html: string): string | null {
  const clean = sanitizeHtml(html, OPTIONS).trim();
  return clean === '' ? null : clean;
}

/** Plain text of an HTML body, for previews and OTP search when a message has no text part. */
export function htmlToPlainText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
