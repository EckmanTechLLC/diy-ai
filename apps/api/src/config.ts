import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface Config {
  port: number;
  host: string;
  databasePath: string;
  /** True when running against the throwaway scratch database (DIY_AI_SCRATCH=1); DATABASE_PATH is then ignored. */
  scratch: boolean;
  webOrigin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.API_PORT ?? 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid API_PORT: ${env.API_PORT}`);
  const scratch = env.DIY_AI_SCRATCH === '1';
  return {
    port,
    host: env.API_HOST || '127.0.0.1',
    databasePath: scratch
      ? resolve(apiRoot, 'data-scratch/diy-ai.sqlite')
      : env.DATABASE_PATH ? resolve(env.DATABASE_PATH) : resolve(apiRoot, 'data/diy-ai.sqlite'),
    scratch,
    webOrigin: env.WEB_ORIGIN || 'http://localhost:5190',
  };
}
