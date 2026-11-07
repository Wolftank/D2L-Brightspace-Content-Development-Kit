import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildableAvenue } from '@cdk/contract';
import type { Project } from './db/schema.js';

/** `back-end/kit`, resolved from this file's own location so it never depends on the working directory. */
export const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'kit');

/** Every avenue CDK can build, in the order the API lists them. */
export const BUILDABLE_AVENUES = ['scorm', 'topic'] as const satisfies readonly BuildableAvenue[];

/** The kit skill that builds each avenue. Its `assets/starter/` is the avenue's starter. */
export const AVENUE_SKILL: Record<BuildableAvenue, string> = {
  scorm: 'd2l-scorm-package',
  topic: 'd2l-content-topic',
};

/** The kit's skills an agent uses to build `avenue`: the avenue's skill and the QA skill. */
export function skillsFor(avenue: BuildableAvenue): string[] {
  return [AVENUE_SKILL[avenue], 'd2l-tenant-qa'];
}

/**
 * The project's avenue, which every project created through the API has.
 *
 * Raises:
 *   Error: when the stored avenue is null or one CDK cannot build.
 */
export function buildableAvenue(project: Pick<Project, 'id' | 'avenue'>): BuildableAvenue {
  const { avenue } = project;
  if (avenue === 'scorm' || avenue === 'topic') return avenue;
  throw new Error(`Project ${project.id} has avenue ${String(avenue)}, which CDK cannot build`);
}
