import { describe, expect, it } from 'vitest';
import { cleanFileName, detectFileType, MAX_FILE_NAME_LENGTH } from './files.js';

const bytes = (...parts: Array<string | number[]>) =>
  Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part))));

describe('detectFileType', () => {
  it.each([
    ['a PDF', bytes('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj'), 'application/pdf'],
    ['a PNG', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], 'IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]), 'image/png'],
    ['a JPG', bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]), 'image/jpeg'],
    ['UTF-8 text', Buffer.from('Week 1: the cell cycle. Café, naïve, 細胞.\n'), 'text/plain'],
  ])('accepts %s by its content', async (_name, content, mime) => {
    expect(await detectFileType(content)).toBe(mime);
  });

  it.each([
    ['a Windows program, whatever it is named', bytes('MZ', [0x90, 0, 3, 0, 0, 0, 4, 0], Array(120).fill(0))],
    ['a GIF', bytes('GIF89a', [1, 0, 1, 0, 0, 0, 0])],
    ['text with a NUL character', Buffer.from('UTF-16 text\0h\0i\0')],
    ['bytes that are not UTF-8', bytes([0xc3, 0x28, 0xa0, 0xa1])],
  ])('refuses %s', async (_name, content) => {
    expect(await detectFileType(content)).toBeUndefined();
  });
});

describe('cleanFileName', () => {
  it.each([
    ['syllabus.pdf', 'syllabus.pdf'],
    ['../../evil.txt', 'evil.txt'],
    ['C:\\Users\\me\\..\\notes.docx', 'notes.docx'],
    ['/etc/passwd', 'passwd'],
    ['a\u0000b\r\nc\u202Egpj.exe', 'abcgpj.exe'],
    ['  week 1.txt  ', 'week 1.txt'],
    ['..', 'file'],
    ['dir/', 'file'],
    ['', 'file'],
    ['Cafe\u0301.txt', 'Café.txt'],
  ])('shows %j as %j', (raw, shown) => {
    expect(cleanFileName(raw)).toBe(shown);
  });

  it('cuts a long name to the limit and keeps its extension', () => {
    const name = cleanFileName(`${'é'.repeat(400)}.docx`);
    expect(Array.from(name)).toHaveLength(MAX_FILE_NAME_LENGTH);
    expect(name.endsWith('é.docx')).toBe(true);
  });
});
