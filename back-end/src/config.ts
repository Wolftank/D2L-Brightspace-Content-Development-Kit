import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AGENT_DRIVERS, AGENT_EFFORTS, type AgentSettings } from './agent/drivers.js';

/** `back-end/`, resolved from this file's own location so it never depends on the working directory. */
export const BACK_END_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The optional settings file. */
export const ENV_FILE = join(BACK_END_DIR, '.env');

export interface Config {
  port: number;
  /** Where the database, workspaces, and builds are stored. Always absolute. */
  dataDir: string;
  agent: AgentSettings;
}

/** A setting is invalid or unusable. The message names the setting and what it must be. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const PORT_RULE = 'must be a whole number from 1 to 65535';

const settingsSchema = z.object({
  AGENT_DRIVER: z.enum(AGENT_DRIVERS, { error: `must be one of ${AGENT_DRIVERS.join(', ')}` }).default('claude'),
  AGENT_MODEL: z.string().trim().min(1, 'must not be blank').optional(),
  AGENT_EFFORT: z.enum(AGENT_EFFORTS, { error: `must be one of ${AGENT_EFFORTS.join(', ')}` }).optional(),
  PORT: z
    .string()
    .regex(/^\d+$/, PORT_RULE)
    .transform(Number)
    .pipe(z.number().int().min(1, PORT_RULE).max(65535, PORT_RULE))
    .default(3000),
  DATA_DIR: z.string().trim().min(1, 'must not be blank').optional(),
});

/** Loads `path` into `process.env`, keeping variables that are already set. A missing file is skipped. */
export function loadEnvFile(path = ENV_FILE): void {
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch (err) {
    throw new ConfigError(`Cannot read ${path}: ${(err as Error).message}`);
  }
}

/** Validates the settings in `env`. Throws `ConfigError` listing every invalid setting. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = settingsSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(['Invalid back-end settings (back-end/.env or the environment):', ...problems].join('\n'));
  }
  const settings = parsed.data;
  return {
    port: settings.PORT,
    dataDir: resolve(BACK_END_DIR, settings.DATA_DIR ?? defaultDataDir(env)),
    agent: { driver: settings.AGENT_DRIVER, model: settings.AGENT_MODEL, effort: settings.AGENT_EFFORT },
  };
}

/** Creates `dataDir` when it is missing and checks it can be written. Throws `ConfigError` naming DATA_DIR otherwise. */
export function checkDataDir(dataDir: string): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    rmSync(mkdtempSync(join(dataDir, '.write-check-')), { recursive: true });
  } catch (err) {
    throw new ConfigError(`DATA_DIR "${dataDir}" cannot be used: ${(err as Error).message}`);
  }
}

/** `%LOCALAPPDATA%\CDK` on Windows, `~/.cdk` elsewhere. */
function defaultDataDir(env: NodeJS.ProcessEnv): string {
  return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'CDK') : join(homedir(), '.cdk');
}
