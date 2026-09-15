import { join } from 'node:path';
import { z } from 'zod';

function defaultDataDir(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'CDK');
  }
  return join(process.env.HOME ?? process.cwd(), '.cdk');
}

const envSchema = z.object({
  DATA_DIR: z.string().min(1).default(defaultDataDir()),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(env);
}

export const config: Config = loadConfig();
