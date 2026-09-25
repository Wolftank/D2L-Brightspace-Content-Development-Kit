import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `back-end/kit`, resolved from this file's own location so it never depends on the working directory. */
export const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'kit');
