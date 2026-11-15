import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectFile } from '@cdk/contract';
import { createApp } from '../app.js';
import { createFilesRepo } from '../db/files.js';
import type { Db } from '../db/index.js';
import { createProjectsRepo } from '../db/projects.js';
import { users as usersTable } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createUsersRepo } from '../db/users.js';
import type { Deps } from '../deps.js';
import { createFileService, MAX_FILE_BYTES } from '../services/files.js';
import { createWorkspaceService, type WorkspaceService } from '../services/workspaces.js';
import { captureLog } from '../test/log.js';

const FIXTURES = join(import.meta.dirname, '..', 'services', '__fixtures__', 'files');

const ACCEPTED = [
  ['field-trip.pdf', 'application/pdf', 'pdf'],
  ['lab-rules.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['reading-list.txt', 'text/plain', 'txt'],
  ['diagram.png', 'image/png', 'png'],
  ['photo.jpg', 'image/jpeg', 'jpg'],
] as const;

describe('project files', () => {
  let db: Db;
  let dataDir: string;
  let workspaces: WorkspaceService;

  function app() {
    const unused = () => {
      throw new Error('not used by these tests');
    };
    const projects = createProjectsRepo(db);
    const deps = {
      users: createUsersRepo(db),
      files: createFileService({ projects, files: createFilesRepo(db), workspaces }),
      preview: { origin: 'http://preview.localhost:3000', appOrigin: 'http://127.0.0.1:5173' },
      projects: { create: unused, get: unused, list: unused },
    } as unknown as Deps;
    return createApp(deps);
  }

  function upload(name: string, content: Buffer, projectId = 'project-1') {
    return request(app()).post(`/api/projects/${projectId}/files`).attach('file', content, name);
  }

  async function filesOnDisk(projectId = 'project-1'): Promise<string[]> {
    return (await readdir(join(workspaces.pathFor(projectId), 'files'))).sort();
  }

  beforeEach(async () => {
    db = testDb();
    dataDir = await mkdtemp(join(tmpdir(), 'cdk-files-'));
    workspaces = createWorkspaceService({ dataDir });
    const projects = createProjectsRepo(db);
    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    db.insert(usersTable).values({ id: 'user-2', displayName: 'Another Instructor' }).run();
    for (const [id, owner] of [['project-1', ownerId], ['project-2', ownerId], ['project-other', 'user-2']] as const) {
      await workspaces.create(id, 'scorm');
      projects.create({ id, ownerId: owner, title: id });
    }
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  describe('POST /api/projects/:projectId/files', () => {
    it.each(ACCEPTED)('stores %s under a new id with its type from its content', async (name, mime, ext) => {
      const content = await readFile(join(FIXTURES, name));

      const res = await upload(name, content);

      expect(res.status).toBe(201);
      const file = res.body.file as ProjectFile;
      expect(file).toEqual({ id: expect.any(String), projectId: 'project-1', name, mime, size: content.length, createdAt: expect.any(Number) });
      expect(await filesOnDisk()).toEqual([`${file.id}.${ext}`]);
      expect(await readFile(join(workspaces.pathFor('project-1'), 'files', `${file.id}.${ext}`))).toEqual(content);
    });

    it('decides the type from the content, not the name or the declared type', async () => {
      const content = await readFile(join(FIXTURES, 'diagram.png'));

      const res = await request(app())
        .post('/api/projects/project-1/files')
        .attach('file', content, { filename: 'notes.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(201);
      expect(res.body.file).toMatchObject({ name: 'notes.pdf', mime: 'image/png' });
      expect(await filesOnDisk()).toEqual([`${res.body.file.id}.png`]);
    });

    it('refuses a program renamed as a PDF with 422 file_not_accepted, and stores nothing', async () => {
      const program = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(256)]);

      const res = await upload('syllabus.pdf', program);

      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'file_not_accepted', nextStep: 'send_again', details: { reason: 'type' } });
      expect(await filesOnDisk()).toEqual([]);
    });

    it('refuses a zip and an empty file', async () => {
      const zip = Buffer.from('504b0304140000000800', 'hex');

      expect((await upload('archive.zip', Buffer.concat([zip, Buffer.alloc(64)]))).body.error.details).toEqual({ reason: 'type' });
      expect((await upload('empty.txt', Buffer.alloc(0))).body.error.details).toEqual({ reason: 'empty' });
      expect(await filesOnDisk()).toEqual([]);
    });

    it('accepts a file of exactly 20 MB and refuses one byte more with 422 too_large', async () => {
      const limit = Buffer.alloc(MAX_FILE_BYTES, 'a');

      const atLimit = await upload('big.txt', limit);
      const overLimit = await upload('bigger.txt', Buffer.concat([limit, Buffer.from('a')]));

      expect(atLimit.status).toBe(201);
      expect(overLimit.status).toBe(422);
      expect(overLimit.body.error).toMatchObject({ code: 'file_not_accepted', details: { reason: 'too_large' } });
      expect(await filesOnDisk()).toEqual([`${atLimit.body.file.id}.txt`]);
    });

    it('stores a name that tries to leave the folder under its id, and keeps only its last segment', async () => {
      const content = await readFile(join(FIXTURES, 'reading-list.txt'));

      const res = await request(app())
        .post('/api/projects/project-1/files')
        .attach('file', content, { filename: '../../..\\..\\escape\r\n.txt' });

      expect(res.status).toBe(201);
      expect(res.body.file.name).toBe('escape.txt');
      expect(await filesOnDisk()).toEqual([`${res.body.file.id}.txt`]);
      expect(await readdir(join(dataDir, 'projects'))).toEqual(['project-1', 'project-2', 'project-other']);
    });

    it('keeps a non-ASCII file name', async () => {
      const res = await upload('Biología – semana 1.txt', Buffer.from('notas'));

      expect(res.body.file.name).toBe('Biología – semana 1.txt');
    });

    it.each([
      ['no file', (req: request.Test) => req.field('note', 'hello')],
      ['a file in another field', (req: request.Test) => req.attach('upload', Buffer.from('hi'), 'a.txt')],
      ['two files', (req: request.Test) => req.attach('file', Buffer.from('a'), 'a.txt').attach('file', Buffer.from('b'), 'b.txt')],
    ])('answers %s with 400 invalid_request', async (_name, build) => {
      const res = await build(request(app()).post('/api/projects/project-1/files'));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
      expect(await filesOnDisk()).toEqual([]);
    });

    it.each(['project-other', 'missing'])('answers project %s with 404 and stores nothing', async (projectId) => {
      const res = await upload('reading-list.txt', Buffer.from('notes'), projectId);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
      if (projectId === 'project-other') expect(await filesOnDisk(projectId)).toEqual([]);
    });

    it('logs the file name at debug only', async () => {
      const records = captureLog();

      const res = await upload('Jordan Lee essay.txt', Buffer.from('An essay'));

      const uploaded = records.find((r) => r.msg === 'File uploaded');
      expect(uploaded).toMatchObject({ level: 30, projectId: 'project-1', fileId: res.body.file.id, mime: 'text/plain', size: 8 });
      expect(records.filter((r) => r.level > 20 && JSON.stringify(r).includes('Jordan Lee'))).toEqual([]);
      expect(records.find((r) => r.msg === 'Uploaded file name')).toMatchObject({ level: 20, name: 'Jordan Lee essay.txt' });
    });
  });

  describe('GET /api/projects/:projectId/files', () => {
    it("lists only the project's files, oldest first", async () => {
      const first = (await upload('a.txt', Buffer.from('a'))).body.file;
      const second = (await upload('b.txt', Buffer.from('b'))).body.file;
      await upload('c.txt', Buffer.from('c'), 'project-2');

      const res = await request(app()).get('/api/projects/project-1/files');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [first, second] });
    });

    it.each(['project-other', 'missing'])('answers project %s with 404', async (projectId) => {
      const res = await request(app()).get(`/api/projects/${projectId}/files`);

      expect(res.status).toBe(404);
    });
  });

  it("goes with the project's workspace when it is removed", async () => {
    await upload('a.txt', Buffer.from('a'));

    await workspaces.remove('project-1');

    expect(await readdir(join(dataDir, 'projects'))).toEqual(['project-2', 'project-other']);
  });
});
