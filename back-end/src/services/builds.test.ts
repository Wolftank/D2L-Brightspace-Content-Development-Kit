import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fromBufferPromise } from 'yauzl';
import { createBuildsRepo, type BuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import { createProjectsRepo } from '../db/projects.js';
import type { Db } from '../db/index.js';
import type { Build, Event } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createUsersRepo } from '../db/users.js';
import { BuildIncomplete, BuildNotReady, NotFound } from '../errors.js';
import { KIT_DIR } from '../kit.js';
import { createEventService, type EventService } from '../pipeline/events.js';
import { createBuildService, type BuildService } from './builds.js';
import { createWorkspaceService, type WorkspaceService } from './workspaces.js';

const BAD_SCORM = join(KIT_DIR, 'harness', 'lint', 'fixtures', 'bad-scorm');

describe('build service', () => {
  let dataDir: string;
  let db: Db;
  let buildsRepo: BuildsRepo;
  let events: EventService;
  let workspaces: WorkspaceService;
  let builds: BuildService;
  let ownerId: string;
  let projectId: string;

  /** A build service whose QA gate is `lint.js` with the given source. */
  async function withStubGate(source: string, gateTimeoutMs?: number): Promise<BuildService> {
    const kitDir = join(dataDir, 'stub-kit');
    await fs.mkdir(join(kitDir, 'harness', 'lint'), { recursive: true });
    await fs.writeFile(join(kitDir, 'harness', 'lint', 'lint.js'), source);
    return createService({ kitDir, gateTimeoutMs });
  }

  function createService(options: { kitDir?: string; gateTimeoutMs?: number } = {}): BuildService {
    return createBuildService({
      builds: buildsRepo,
      projects: createProjectsRepo(db),
      workspaces,
      events,
      ...options,
    });
  }

  async function replaceOutput(fromDir: string): Promise<void> {
    const outDir = join(workspaces.pathFor(projectId), 'out');
    await fs.rm(outDir, { recursive: true });
    await fs.cp(fromDir, outDir, { recursive: true });
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-builds-'));
    db = testDb();
    buildsRepo = createBuildsRepo(db);
    events = createEventService(createEventsRepo(db));
    workspaces = createWorkspaceService({ dataDir });
    ownerId = createUsersRepo(db).ensureLocalUser().id;
    projectId = createProjectsRepo(db).create({ ownerId, title: 'Cell division practice' }).id;
    await workspaces.create(projectId);
    builds = createService();
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('produces a ready build whose report passes for the SCORM starter', async () => {
      const build = await builds.create(projectId, 'turn-1');

      expect(build).toMatchObject({ projectId, version: 1, status: 'ready', avenue: 'scorm', turnId: 'turn-1', error: null });
      expect(build.qa?.passed).toBe(true);
    });

    it('produces a failed build with findings, explanations included, for fixtures/bad-scorm', async () => {
      await replaceOutput(BAD_SCORM);

      const build = await builds.create(projectId);

      expect(build.status).toBe('failed');
      expect(build.qa?.passed).toBe(false);
      expect(build.error).toMatchObject({ code: 'qa_failed' });
      const manifestFinding = build.qa?.findings.find((f) => f.rule === 'scorm/manifest');
      expect(manifestFinding).toMatchObject({ severity: 'error', file: 'imsmanifest.xml', line: null });
      expect(manifestFinding?.because).toEqual(expect.any(String));
    });

    it('assigns versions 1, 2, 3 and keeps each version’s files', async () => {
      const first = await builds.create(projectId);
      const firstIndex = await fs.readFile(join(workspaces.buildPathFor(projectId, '1'), 'index.html'), 'utf8');

      const outIndex = join(workspaces.pathFor(projectId), 'out', 'index.html');
      await fs.writeFile(outIndex, firstIndex.replace('</body>', '<p>edited</p></body>'));
      const second = await builds.create(projectId);
      const third = await builds.create(projectId);

      expect([first.version, second.version, third.version]).toEqual([1, 2, 3]);
      expect(await fs.readFile(join(workspaces.buildPathFor(projectId, '1'), 'index.html'), 'utf8')).toBe(firstIndex);
      expect(await fs.readFile(join(workspaces.buildPathFor(projectId, '2'), 'index.html'), 'utf8')).toContain(
        '<p>edited</p>',
      );
    });

    it('fails a build whose copy fails, using up its version without blocking the next build', async () => {
      await fs.mkdir(workspaces.buildPathFor(projectId, '1'), { recursive: true });
      const kinds: string[] = [];
      events.subscribe(projectId, (event) => kinds.push(event.kind));

      const failed = await builds.create(projectId);
      const next = await builds.create(projectId);

      expect(failed).toMatchObject({ version: 1, status: 'failed', qa: null, error: { code: 'copy_failed' } });
      expect(kinds.slice(0, 2)).toEqual(['build.created', 'build.updated']);
      expect(next).toMatchObject({ version: 2, status: 'ready' });
    });

    it('gives concurrent builds of one project distinct versions', async () => {
      const [first, second] = await Promise.all([builds.create(projectId), builds.create(projectId)]);

      expect([first.version, second.version].sort()).toEqual([1, 2]);
      expect([first.status, second.status]).toEqual(['ready', 'ready']);
    });

    it('saves the report as qa.json in the build directory and on the build', async () => {
      const build = await builds.create(projectId);

      const stored = JSON.parse(await fs.readFile(join(workspaces.buildPathFor(projectId, '1'), 'qa.json'), 'utf8'));
      expect(stored).toEqual(build.qa);
      expect(buildsRepo.get(build.id)?.qa).toEqual(build.qa);
    });

    it('emits build.created as checking, then build.updated after the final status is saved', async () => {
      const received: { event: Event; storedStatus: string | undefined }[] = [];
      events.subscribe(projectId, (event) => {
        const { build } = event.payload as { build: Build };
        received.push({ event, storedStatus: buildsRepo.get(build.id)?.status });
      });

      const build = await builds.create(projectId, 'turn-1');

      expect(received.map(({ event }) => event.kind)).toEqual(['build.created', 'build.updated']);
      const [created, updated] = received;
      expect((created!.event.payload as { build: Build }).build.status).toBe('checking');
      expect(updated!.event.payload).toEqual({ build });
      expect(updated!.storedStatus).toBe('ready');
      expect(updated!.event.turnId).toBe('turn-1');
    });

    it('produces ready when the gate reports only warnings, keeping each finding', async () => {
      const report = {
        pass: true,
        errorCount: 0,
        findings: [
          { rule: 'a11y/alt', severity: 'warn', file: 'index.html', line: 12, message: 'm', because: 'b', unverified: true },
        ],
      };
      const service = await withStubGate(`process.stdout.write(${JSON.stringify(JSON.stringify(report))});`);

      const build = await service.create(projectId);

      expect(build.status).toBe('ready');
      expect(build.qa).toEqual({
        passed: true,
        findings: [{ rule: 'a11y/alt', severity: 'warn', file: 'index.html', line: 12, message: 'm', because: 'b' }],
      });
    });

    it('fails with an error when the gate prints something other than JSON', async () => {
      const service = await withStubGate(`process.stdout.write('not json');`);

      const build = await service.create(projectId);

      expect(build).toMatchObject({ status: 'failed', qa: null, error: { code: 'gate_invalid_output' } });
    });

    it('fails with an error when the report has an unexpected shape', async () => {
      const service = await withStubGate(`process.stdout.write(JSON.stringify({ pass: 'yes' }));`);

      const build = await service.create(projectId);

      expect(build).toMatchObject({ status: 'failed', qa: null, error: { code: 'gate_invalid_output' } });
    });

    it('fails with an error when the gate process crashes', async () => {
      const service = await withStubGate(`throw new Error('boom');`);

      const build = await service.create(projectId);

      expect(build).toMatchObject({ status: 'failed', qa: null, error: { code: 'gate_crashed' } });
    });

    it('fails with an error when the gate exits with an unexpected code', async () => {
      const service = await withStubGate(`console.error('Could not read tenant-profile.json'); process.exitCode = 2;`);

      const build = await service.create(projectId);

      expect(build).toMatchObject({ status: 'failed', qa: null, error: { code: 'gate_crashed' } });
      expect(build.error?.message).toContain('Could not read tenant-profile.json');
    });

    it('fails with an error when the gate runs past its timeout', async () => {
      const service = await withStubGate(`setInterval(() => {}, 1000);`, 200);

      const build = await service.create(projectId);

      expect(build).toMatchObject({ status: 'failed', qa: null, error: { code: 'gate_crashed' } });
    });

    it('fails with an error when the exit code contradicts a passing report', async () => {
      const service = await withStubGate(
        `process.stdout.write(JSON.stringify({ pass: true, findings: [] })); process.exitCode = 1;`,
      );

      const build = await service.create(projectId);

      expect(build).toMatchObject({ status: 'failed', qa: null, error: { code: 'gate_inconsistent' } });
    });
  });

  describe('get', () => {
    it('returns the owner’s build', async () => {
      const build = await builds.create(projectId);

      expect(builds.get(ownerId, build.id)).toEqual(build);
    });

    it('throws NotFound for another owner’s build and for an unknown id', async () => {
      const build = await builds.create(projectId);

      expect(() => builds.get('someone-else', build.id)).toThrow(NotFound);
      expect(() => builds.get(ownerId, 'no-such-build')).toThrow(NotFound);
    });
  });

  describe('download', () => {
    it('zips a ready build with the manifest at the root and every declared file', async () => {
      const build = await builds.create(projectId);

      const { filename, stream } = await builds.download(ownerId, build.id);
      const names = await zipEntryNames(stream);

      expect(filename).toBe('build-1.zip');
      expect(names).toContain('imsmanifest.xml');
      expect(names).toContain('index.html');
      expect(names).not.toContain('qa.json');
    });

    it('refuses a build that is not ready', async () => {
      await replaceOutput(BAD_SCORM);
      const build = await builds.create(projectId);

      await expect(builds.download(ownerId, build.id)).rejects.toThrow(BuildNotReady);
    });

    it('refuses a build missing a file its manifest declares', async () => {
      const build = await builds.create(projectId);
      await fs.rm(join(workspaces.buildPathFor(projectId, '1'), 'index.html'));

      await expect(builds.download(ownerId, build.id)).rejects.toMatchObject(
        new BuildIncomplete(['index.html']),
      );
    });

    it('refuses a build missing its manifest', async () => {
      const build = await builds.create(projectId);
      await fs.rm(join(workspaces.buildPathFor(projectId, '1'), 'imsmanifest.xml'));

      await expect(builds.download(ownerId, build.id)).rejects.toMatchObject(
        new BuildIncomplete(['imsmanifest.xml']),
      );
    });

    it('treats a declared file outside the build as missing', async () => {
      const build = await builds.create(projectId);
      const manifestPath = join(workspaces.buildPathFor(projectId, '1'), 'imsmanifest.xml');
      const manifest = await fs.readFile(manifestPath, 'utf8');
      await fs.writeFile(manifestPath, manifest.replace('<file href="index.html"/>', '<file href="index.html"/><file href="../2/index.html"/>'));

      await expect(builds.download(ownerId, build.id)).rejects.toMatchObject(
        new BuildIncomplete(['../2/index.html']),
      );
    });

    it('throws NotFound for another owner’s build', async () => {
      const build = await builds.create(projectId);

      await expect(builds.download('someone-else', build.id)).rejects.toThrow(NotFound);
    });
  });
});

async function zipEntryNames(stream: Readable): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);

  const zip = await fromBufferPromise(Buffer.concat(chunks), { lazyEntries: true });
  const names: string[] = [];
  for await (const entry of zip.eachEntry()) names.push(entry.fileName);
  return names;
}
