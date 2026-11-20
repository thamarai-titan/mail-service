import {
  attachmentDisposition,
  safeContentType,
} from './content-disposition.js';

describe('attachmentDisposition', () => {
  it('keeps plain names', () => {
    expect(attachmentDisposition('invoice.pdf')).toBe(
      `attachment; filename="invoice.pdf"; filename*=UTF-8''invoice.pdf`,
    );
  });

  it('cannot be broken out of with quotes or new lines', () => {
    const header = attachmentDisposition('a"; filename=evil.html\r\nX: y.txt');
    expect(header).not.toMatch(/[\r\n]/);
    expect(
      header.startsWith(
        'attachment; filename="a__ filename=evil.htmlX: y.txt"',
      ),
    ).toBe(true);
  });

  it('encodes non-ASCII names and gives an ASCII fallback', () => {
    expect(attachmentDisposition('résumé.pdf')).toBe(
      `attachment; filename="resume.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`,
    );
    expect(attachmentDisposition('報告.pdf')).toContain('filename=".pdf"');
  });
});

describe('safeContentType', () => {
  it('passes simple types and replaces anything else', () => {
    expect(safeContentType('application/pdf')).toBe('application/pdf');
    expect(safeContentType('text/html; charset=utf-8')).toBe(
      'application/octet-stream',
    );
    expect(safeContentType('text/plain\r\nX-Evil: 1')).toBe(
      'application/octet-stream',
    );
  });
});
