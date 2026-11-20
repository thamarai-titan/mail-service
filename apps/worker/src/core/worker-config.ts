import { Injectable } from '@nestjs/common';
import { storageConfigFromEnv, type StorageConfig } from '@repo/storage';

// Apps run from their own directory (turbo) or the repository root; the shared .env is at the root.
// Variables already set in the process environment win over the file.
for (const path of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(path);
  } catch {
    // Missing file: rely on the process environment (the normal case in production).
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env at the repository root.`,
    );
  }
  return value;
}

/** Validated runtime configuration. Fails fast at startup when a required variable is missing. */
@Injectable()
export class WorkerConfig {
  readonly databaseUrl = required('DATABASE_URL');
  readonly redisUrl = required('REDIS_URL');
  readonly storage: StorageConfig = storageConfigFromEnv();
  /** Jobs processed at the same time by one worker process. */
  readonly concurrency = Number(process.env['WORKER_CONCURRENCY'] ?? 20);
}
