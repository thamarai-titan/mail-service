import { extname } from 'node:path';

/** README section 11 / Appendix B. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_STORED_ATTACHMENTS = 10;
/** Parts past this are not even listed, so a message with thousands of parts stays small. */
export const MAX_LISTED_ATTACHMENTS = 50;
const MAX_FILENAME_LENGTH = 200;

/** Executables, scripts, installers, shortcuts and macro-enabled Office files. */
// prettier-ignore
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'com', 'scr', 'pif', 'bat', 'cmd', 'msi', 'msp', 'msix', 'appx', 'dll', 'cpl', 'msc',
  'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1', 'hta', 'jar', 'lnk', 'reg', 'scf',
  'sh', 'app', 'dmg', 'pkg', 'iso', 'img', 'vhd', 'vhdx',
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppsm', 'ppam', 'sldm',
]);

const BLOCKED_CONTENT_TYPE =
  /^application\/(x-msdownload|x-msdos-program|x-ms-installer|x-msi|x-dosexec|x-executable|x-sh|x-bat|javascript|x-javascript|hta|java-archive)$|macroenabled/i;

export type BlockReason = 'type' | 'size' | 'count';

export interface IncomingPart {
  filename?: string | undefined;
  contentType: string;
  size: number;
}

export interface AttachmentDecision {
  filename: string;
  contentType: string;
  blocked: BlockReason | null;
}

/** A display-safe file name: no path, no control characters, bounded length. */
export function safeFilename(name: string | undefined, index: number): string {
  const base = (name ?? '')
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (base === '' || base === '.' || base === '..')
    return `attachment-${index + 1}`;
  if (base.length <= MAX_FILENAME_LENGTH) return base;
  const ext = extname(base).slice(0, 20);
  return base.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
}

/**
 * Decides for each part whether its content is stored. Blocked parts keep their metadata so
 * the reader sees that something was removed. Parts are judged in order, so the first ten
 * allowed ones are stored.
 */
export function applyAttachmentPolicy(
  parts: IncomingPart[],
): AttachmentDecision[] {
  let stored = 0;
  return parts.slice(0, MAX_LISTED_ATTACHMENTS).map((part, index) => {
    const filename = safeFilename(part.filename, index);
    const contentType =
      part.contentType.toLowerCase() || 'application/octet-stream';
    const extension = extname(filename).slice(1).toLowerCase();

    let blocked: BlockReason | null = null;
    if (
      BLOCKED_EXTENSIONS.has(extension) ||
      BLOCKED_CONTENT_TYPE.test(contentType)
    ) {
      blocked = 'type';
    } else if (part.size > MAX_ATTACHMENT_BYTES) {
      blocked = 'size';
    } else if (stored >= MAX_STORED_ATTACHMENTS) {
      blocked = 'count';
    } else {
      stored += 1;
    }
    return { filename, contentType, blocked };
  });
}
