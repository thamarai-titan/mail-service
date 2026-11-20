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

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`${name} must be a port number.`);
  }
  return value;
}

/** Validated runtime configuration. Fails fast at startup when a required variable is missing. */
@Injectable()
export class IngestConfig {
  readonly databaseUrl = required('DATABASE_URL');
  readonly redisUrl = required('REDIS_URL');
  readonly storage: StorageConfig = storageConfigFromEnv();
  /**
   * Interface for the LMTP and policy listeners. Only Postfix may reach them: keep this on
   * loopback or the private network between the mail server and ingest.
   */
  readonly listenHost = process.env['INGEST_HOST'] ?? '127.0.0.1';
  /** Postfix hands accepted mail over here (`lmtp:inet:host:port`). */
  readonly lmtpPort = port('INGEST_LMTP_PORT', 2525);
  /** Postfix asks here whether a recipient exists (`check_policy_service inet:host:port`). */
  readonly policyPort = port('INGEST_POLICY_PORT', 10040);
  /** Matches Postfix's message_size_limit, as a second line of defense. */
  readonly maxMessageBytes = Number(
    process.env['MAX_MESSAGE_BYTES'] ?? 10 * 1024 * 1024,
  );
}
