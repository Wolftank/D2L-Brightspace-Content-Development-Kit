import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { z } from 'zod';

/** `back-end/`, resolved from this file so the working directory does not matter. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where `loadDotEnv` looks by default: `back-end/.env`. */
export const ENV_FILE = join(PACKAGE_DIR, '.env');

function defaultDataDir(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'CDK');
  }
  return join(process.env.HOME ?? process.cwd(), '.cdk');
}

const envSchema = z.object({
  AGENT_DRIVER: z.enum(['claude']).default('claude'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Resolved to an absolute path: a relative DATA_DIR would otherwise depend
  // on the working directory and break the session service's workspace check.
  DATA_DIR: z
    .string()
    .trim()
    .min(1)
    .default(defaultDataDir())
    .transform((dir) => resolve(dir)),
});

export type Config = z.infer<typeof envSchema>;

/** What each setting accepts, for the startup error a misconfiguration produces. */
const EXPECTED: Record<keyof Config, string> = {
  AGENT_DRIVER: "'claude'",
  PORT: 'an integer from 1 to 65535',
  DATA_DIR: 'a non-empty directory path',
};

/**
 * Copies `path`'s settings into `env`, skipping keys the environment already
 * defines, so real environment variables take precedence over the file. A
 * missing file is fine; `.env` is optional.
 */
export function loadDotEnv(path: string = ENV_FILE, env: NodeJS.ProcessEnv = process.env): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (!(key in env)) env[key] = value;
  }
}

/**
 * Parses and validates the settings, applying defaults.
 *
 * @throws Error naming each invalid setting, the value it expects, and the
 *         value it got, so startup stops with an actionable message.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (parsed.success) return parsed.data;

  const lines = parsed.error.issues.map((issue) => {
    const setting = String(issue.path[0]) as keyof Config;
    return `  ${setting}: expected ${EXPECTED[setting]}, got ${JSON.stringify(env[setting])}`;
  });
  throw new Error(`Invalid backend settings:\n${lines.join('\n')}`);
}
