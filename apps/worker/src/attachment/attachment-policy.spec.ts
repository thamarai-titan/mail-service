import {
  applyAttachmentPolicy,
  MAX_ATTACHMENT_BYTES,
  safeFilename,
} from './attachment-policy.js';

const part = (
  filename: string,
  contentType = 'application/pdf',
  size = 100,
) => ({
  filename,
  contentType,
  size,
});

describe('applyAttachmentPolicy', () => {
  it('allows ordinary files', () => {
    expect(applyAttachmentPolicy([part('invoice.pdf')])).toEqual([
      {
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        blocked: null,
      },
    ]);
  });

  it('blocks executables, scripts and macro Office files by extension', () => {
    const names = [
      'setup.exe',
      'run.JS',
      'invoice.pdf.scr',
      'budget.xlsm',
      'a.lnk',
    ];
    const result = applyAttachmentPolicy(names.map((name) => part(name)));
    expect(result.map((r) => r.blocked)).toEqual([
      'type',
      'type',
      'type',
      'type',
      'type',
    ]);
  });

  it('blocks by content type when the name looks harmless', () => {
    const [result] = applyAttachmentPolicy([
      part('report', 'application/vnd.ms-excel.sheet.macroEnabled.12'),
    ]);
    expect(result?.blocked).toBe('type');
    const [exe] = applyAttachmentPolicy([
      part('photo.jpg', 'application/x-msdownload'),
    ]);
    expect(exe?.blocked).toBe('type');
  });

  it('blocks files over 5 MB', () => {
    const [result] = applyAttachmentPolicy([
      part('big.zip', 'application/zip', MAX_ATTACHMENT_BYTES + 1),
    ]);
    expect(result?.blocked).toBe('size');
  });

  it('stores at most ten, not counting blocked ones', () => {
    const parts = [
      part('x.exe'),
      ...Array.from({ length: 11 }, (_, i) => part(`${i}.pdf`)),
    ];
    const result = applyAttachmentPolicy(parts);
    expect(result.filter((r) => r.blocked === null)).toHaveLength(10);
    expect(result.at(-1)?.blocked).toBe('count');
  });
});

describe('safeFilename', () => {
  it('removes paths and control characters', () => {
    expect(safeFilename('../../etc/passwd', 0)).toBe('passwd');
    expect(safeFilename('C:\\Users\\a\\b.txt', 0)).toBe('b.txt');
    expect(safeFilename('a\u0000b\nc.txt', 0)).toBe('abc.txt');
  });

  it('names unnamed parts and keeps the extension of long names', () => {
    expect(safeFilename(undefined, 2)).toBe('attachment-3');
    const long = safeFilename(`${'a'.repeat(300)}.pdf`, 0);
    expect(long).toHaveLength(200);
    expect(long.endsWith('.pdf')).toBe(true);
  });
});
