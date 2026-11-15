import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FileListResponse, FileMime, ProjectFile } from '@cdk/contract';
import { fileTypeFromBuffer } from 'file-type';
import mammoth from 'mammoth';
import type { Logger } from 'pino';
import type { TurnInput } from '../agent/AgentDriver.js';
import type { FilesRepo } from '../db/files.js';
import type { ProjectsRepo } from '../db/projects.js';
import type { File } from '../db/schema.js';
import { FileNotAccepted, NotFound } from '../errors.js';
import type { WorkspaceService } from './workspaces.js';

/** The largest file an instructor can upload: 20 MB. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The longest file name kept, in characters. */
export const MAX_FILE_NAME_LENGTH = 255;

const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Each accepted type and the extension its file is stored with. */
const ACCEPTED_TYPES: Record<FileMime, string> = {
  'application/pdf': 'pdf',
  [WORD_MIME]: 'docx',
  'text/plain': 'txt',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export interface UploadInput {
  /** The name the file was uploaded with. */
  name: string;
  bytes: Buffer;
}

export interface FileServiceDeps {
  projects: Pick<ProjectsRepo, 'get'>;
  files: Pick<FilesRepo, 'create' | 'listByProject'>;
  workspaces: Pick<WorkspaceService, 'locate'>;
}

export interface FileService {
  /**
   * Stores an upload in the project's `files/` under a new id and records it.
   * A Word file's text is stored beside it as `<id>.txt`. Throws `NotFound` for an unknown or another owner's project, and
   * `FileNotAccepted` when the file is empty, its content is not an accepted
   * type, or it is a Word file mammoth cannot read.
   */
  upload(ownerId: string, projectId: string, input: UploadInput, logger: Logger): Promise<ProjectFile>;
  /** The project's files, oldest first. Throws `NotFound` for an unknown or another owner's project. */
  list(ownerId: string, projectId: string): FileListResponse;
}

export function createFileService(deps: FileServiceDeps): FileService {
  return {
    async upload(ownerId, projectId, { name, bytes }, logger) {
      if (!deps.projects.get(ownerId, projectId)) throw new NotFound();
      const mime = bytes.length === 0 ? undefined : await detectFileType(bytes);
      if (!mime) {
        const reason = bytes.length === 0 ? 'empty' : 'type';
        logger.info({ projectId, reason, size: bytes.length }, 'File not accepted');
        throw new FileNotAccepted(reason);
      }

      const text = mime === WORD_MIME ? await wordText(bytes) : undefined;
      if (text === null) {
        logger.info({ projectId, reason: 'type', size: bytes.length }, 'File not accepted');
        throw new FileNotAccepted('type');
      }

      const id = randomUUID();
      const filesDir = join(await deps.workspaces.locate(projectId), 'files');
      const written = [join(filesDir, storedName({ id, mime }))];
      if (text !== undefined) written.push(join(filesDir, `${id}.txt`));
      try {
        await fs.writeFile(written[0]!, bytes, { flag: 'wx' });
        if (text !== undefined) await fs.writeFile(written[1]!, text, { encoding: 'utf8', flag: 'wx' });
        const file = deps.files.create({ id, projectId, name: cleanFileName(name), mime, size: bytes.length });
        logger.info({ projectId, fileId: id, mime, size: bytes.length }, 'File uploaded');
        logger.debug({ projectId, fileId: id, name: file.name }, 'Uploaded file name');
        return file;
      } catch (err) {
        await Promise.all(written.map((path) => fs.rm(path, { force: true })));
        throw err;
      }
    },

    list(ownerId, projectId) {
      if (!deps.projects.get(ownerId, projectId)) throw new NotFound();
      return { items: deps.files.listByProject(projectId) };
    },
  };
}

/** The file's name in the workspace's `files/`: its id and the extension of its type. */
export function storedName(file: Pick<File, 'id' | 'mime'>): string {
  return `${file.id}.${ACCEPTED_TYPES[file.mime]}`;
}

/**
 * What the agent is given for a file in `filesDir`: a Word file's text,
 * stored beside it as `<id>.txt`, or the file itself.
 */
export function attachmentFor(file: File, filesDir: string): TurnInput['attachments'][number] {
  return file.mime === WORD_MIME
    ? { path: join(filesDir, `${file.id}.txt`), name: file.name, mime: 'text/plain' }
    : { path: join(filesDir, storedName(file)), name: file.name, mime: file.mime };
}

/** A Word file's text, or `null` when mammoth cannot read it. */
async function wordText(bytes: Buffer): Promise<string | null> {
  try {
    return (await mammoth.extractRawText({ buffer: bytes })).value;
  } catch {
    return null;
  }
}

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
