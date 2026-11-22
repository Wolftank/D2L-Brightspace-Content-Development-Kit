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

/** The kit skill that picks an avenue from the instructor's request. */
export const ROUTER_SKILL = 'd2l-experience-router';

/** The kit skill that finds TILT and UDL suggestions for what the agent builds. */
export const SUGGESTIONS_SKILL = 'd2l-tilt-udl-suggestions';

/**
 * The kit's skills an agent uses on a project: every avenue's skill, so it can
 * rebuild in another avenue within a request, and the QA skill. A project with
 * no avenue also gets the router skill.
 */
export function skillsFor(avenue: BuildableAvenue | null): string[] {
  return [...(avenue ? [] : [ROUTER_SKILL]), ...BUILDABLE_AVENUES.map((each) => AVENUE_SKILL[each]), 'd2l-tenant-qa'];
}

/**
 * The project's avenue, which a project has once it is created with one or the agent picks one.
 *
 * Raises:
 *   Error: when the stored avenue is null or one CDK cannot build.
 */
export function buildableAvenue(project: Pick<Project, 'id' | 'avenue'>): BuildableAvenue {
  const { avenue } = project;
  if (avenue === 'scorm' || avenue === 'topic') return avenue;
  throw new Error(`Project ${project.id} has avenue ${String(avenue)}, which CDK cannot build`);
}

/** The project's avenue, or null before one is picked. Raises as `buildableAvenue` does for a stored avenue CDK cannot build. */
export function pickedAvenue(project: Pick<Project, 'id' | 'avenue'>): BuildableAvenue | null {
  return project.avenue === null ? null : buildableAvenue(project);
}
