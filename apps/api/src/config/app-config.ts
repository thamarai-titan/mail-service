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

function serverPepper(): string {
  const value = required('SERVER_PEPPER');
  if (value.length < 32) {
    throw new Error('SERVER_PEPPER must be at least 32 characters.');
  }
  return value;
}

/** Validated runtime configuration. Fails fast at startup when a required variable is missing. */
@Injectable()
export class AppConfig {
  readonly databaseUrl = required('DATABASE_URL');
  readonly redisUrl = required('REDIS_URL');
  /** Object storage holding attachments and raw messages. */
  readonly storage: StorageConfig = storageConfigFromEnv();
  /** HMAC key for session tokens and IP addresses. Changing it invalidates every session. */
  readonly serverPepper = serverPepper();
  /** Browsers only send Secure cookies over HTTPS, so plain-HTTP local development turns it off. */
  readonly secureCookies = process.env['NODE_ENV'] === 'production';
  /** Number of reverse proxies in front of the API, so `req.ip` is the real client address. */
  readonly trustProxyHops = Number(process.env['TRUST_PROXY_HOPS'] ?? 0);
}
