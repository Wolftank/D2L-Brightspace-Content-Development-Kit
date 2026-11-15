export interface Attachment {
  id: number;
  file: File;
}

export const MAX_ATTACHMENTS = 10;
const MAX_BYTES = 20 * 1024 * 1024;
const FORMATS = 'PDF, Word (.docx), text, PNG or JPG';
const MIMES = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg']);

export function attachmentProblem(file: File): string | undefined {
  if (file.size === 0) return 'the file is empty.';
  if (file.size > MAX_BYTES) return 'the file must be 20 MB or smaller.';
  if (MIMES.has(file.type) || file.type.startsWith('text/')) return;
  if ((!file.type || file.type === 'application/octet-stream') && /\.(pdf|docx|txt|png|jpe?g)$/i.test(file.name)) return;
  return 'choose a ' + FORMATS + ' file.';
}
