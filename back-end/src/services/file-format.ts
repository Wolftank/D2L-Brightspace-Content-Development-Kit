import { extname } from 'node:path';
import type { FileMime } from '@cdk/contract';
import { fileTypeFromBuffer } from 'file-type';

/** The largest file an instructor can upload: 20 MB. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The longest file name kept, in characters. */
export const MAX_FILE_NAME_LENGTH = 255;

export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Each accepted type and the extension its file is stored with. */
export const ACCEPTED_TYPES: Record<FileMime, string> = {
  'application/pdf': 'pdf',
  [WORD_MIME]: 'docx',
  'text/plain': 'txt',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/**
 * The accepted type of a file, decided by its content alone. PDF, Word, PNG,
 * and JPG are recognized by their signatures; a file with no signature is
 * text when it is valid UTF-8 with no NUL character.
 *
 * Returns:
 *   The type, or `undefined` when the content is none of the accepted types.
 */
export async function detectFileType(bytes: Uint8Array): Promise<FileMime | undefined> {
  const detected = await fileTypeFromBuffer(bytes);
  if (detected) return detected.mime in ACCEPTED_TYPES ? (detected.mime as FileMime) : undefined;
  return isUtf8Text(bytes) ? 'text/plain' : undefined;
}

function isUtf8Text(bytes: Uint8Array): boolean {
  try {
    return !new TextDecoder('utf-8', { fatal: true }).decode(bytes).includes('\0');
  } catch {
    return false;
  }
}

/**
 * The name a file is shown with: the last segment of `raw` after `/` or `\`,
 * in NFC, without control or format characters, trimmed, and cut to
 * `MAX_FILE_NAME_LENGTH` characters keeping a short extension. `file` when
 * nothing is left or only `.` or `..` is.
 */
export function cleanFileName(raw: string): string {
  const segment = raw.split(/[\\/]/).at(-1) ?? '';
  const name = segment.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  if (name === '' || name === '.' || name === '..') return 'file';
  const chars = Array.from(name);
  if (chars.length <= MAX_FILE_NAME_LENGTH) return name;
  const ext = Array.from(extname(name));
  const kept = ext.length > 0 && ext.length <= 16 ? ext : [];
  return chars.slice(0, MAX_FILE_NAME_LENGTH - kept.length).join('') + kept.join('');
}
