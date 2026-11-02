import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `back-end/kit`, resolved from this file's own location so it never depends on the working directory. */
export const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'kit');

/** The kit's skills an agent uses to build a SCORM activity: the SCORM skill and the QA skill. */
export const SCORM_SKILLS = ['d2l-scorm-package', 'd2l-tenant-qa'];

/** The kit's skills an agent uses to build a content topic: the topic skill and the QA skill. */
export const TOPIC_SKILLS = ['d2l-content-topic', 'd2l-tenant-qa'];

/** Returns the skill set for the given avenue. */
export function skillsForAvenue(avenue: 'scorm' | 'topic'): string[] {
  return avenue === 'topic' ? TOPIC_SKILLS : SCORM_SKILLS;
}
