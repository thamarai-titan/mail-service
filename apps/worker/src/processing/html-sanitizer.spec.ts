import { htmlToPlainText, sanitizeEmailHtml } from './html-sanitizer.js';

describe('sanitizeEmailHtml', () => {
  it('removes scripts, forms, frames and event handlers', () => {
    const html = sanitizeEmailHtml(
      '<p onclick="steal()">Hi</p><script>alert(1)</script>' +
        '<form action="https://evil.example"><input name="pw"></form>' +
        '<iframe src="https://evil.example"></iframe>',
    );
    expect(html).toBe('<p>Hi</p>');
  });

  it('drops javascript: links and makes links open safely', () => {
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      '<a target="_blank" rel="noopener noreferrer nofollow">x</a>',
    );
    expect(sanitizeEmailHtml('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">x</a>',
    );
  });

  it('keeps inline styles, table layout and images', () => {
    const input =
      '<table width="600" cellpadding="0"><tr><td style="color:red" bgcolor="#fff">' +
      '<img src="https://img.example/a.png" alt="logo"><img src="data:image/png;base64,AAAA"></td></tr></table>';
    expect(sanitizeEmailHtml(input)).toContain('style="color:red"');
    expect(sanitizeEmailHtml(input)).toContain(
      'src="https://img.example/a.png"',
    );
    expect(sanitizeEmailHtml(input)).toContain(
      'src="data:image/png;base64,AAAA"',
    );
  });

  it('drops data: URIs outside images and protocol-relative URLs', () => {
    expect(
      sanitizeEmailHtml(
        '<a href="data:text/html,<b>x</b>">x</a><img src="//t.example/p.gif">',
      ),
    ).toBe(
      '<a target="_blank" rel="noopener noreferrer nofollow">x</a><img />',
    );
  });

  it('returns null when nothing is left', () => {
    expect(sanitizeEmailHtml('<script>x()</script>  ')).toBeNull();
  });
});

describe('htmlToPlainText', () => {
  it('strips tags and decodes common entities', () => {
    expect(
      htmlToPlainText('<p>Code:&nbsp;<b>123456</b></p>\n\n<p>A &amp; B</p>'),
    ).toBe('Code: 123456\nA & B');
  });
});
