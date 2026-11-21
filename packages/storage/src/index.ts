import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

export interface StorageConfig {
  /** S3 endpoint, e.g. http://localhost:9000 for the local RustFS container. */
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

/** Reads S3_* variables. Throws when one is missing so apps fail at startup, not on first upload. */
export function storageConfigFromEnv(env = process.env): StorageConfig {
  const read = (name: string): string => {
    const value = env[name];
    if (!value) {
      throw new Error(
        `${name} is not set. Copy .env.example to .env at the repository root.`,
      );
    }
    return value;
  };
  return {
    endpoint: read('S3_ENDPOINT'),
    region: env['S3_REGION'] || 'us-east-1',
    accessKey: read('S3_ACCESS_KEY'),
    secretKey: read('S3_SECRET_KEY'),
    bucket: read('S3_BUCKET'),
  };
}

/** Object key layout. Prefixes match the cleanup rules in README section 8. */
export const objectKeys = {
  /** The message exactly as received, kept for replay. */
  raw: (id: string) => `raw/${id}.eml`,
  /** Raw messages that could not be parsed. */
  quarantine: (id: string) => `quarantine/${id}.eml`,
  /**
   * One stored attachment. Keyed by the inbox, the message's dedupe hash and the part's
   * position, so a retried job overwrites its own uploads instead of leaving orphans.
   */
  attachment: (inboxId: string, dedupeHash: string, index: number) =>
    `att/${inboxId}/${dedupeHash}/${index}`,
};

export interface StoredObject {
  body: Readable;
  contentLength: number | undefined;
}

/** One entry of a bucket listing. */
export interface ListedObject {
  key: string;
  lastModified: Date;
}

/** Deletes run this many at a time, so a large batch does not flood the server. */
const DELETE_CONCURRENCY = 10;

/** The S3 operations the apps need, against one bucket. */
export class ObjectStorage {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      // RustFS and most self-hosted servers address buckets by path, not by subdomain.
      forcePathStyle: true,
    });
  }

  /** Creates the bucket when it does not exist yet. Safe to call on every start. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** The object as a stream, or null when it does not exist. */
  async getStream(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        body: response.Body as Readable,
        contentLength: response.ContentLength,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** The whole object in memory, or null when it does not exist. Fine for mail-sized objects. */
  async get(key: string): Promise<Buffer | null> {
    const object = await this.getStream(key);
    if (!object) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /** Deleting a key that does not exist succeeds. */
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /** Deletes every key, a few at a time. Keys that do not exist are fine. */
  async deleteMany(keys: readonly string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += DELETE_CONCURRENCY) {
      await Promise.all(
        keys.slice(i, i + DELETE_CONCURRENCY).map((key) => this.delete(key)),
      );
    }
  }

  /** The objects under a prefix, one page (up to 1000) at a time. */
  async *listPages(prefix: string): AsyncGenerator<ListedObject[]> {
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const page = (response.Contents ?? []).flatMap((object) =>
        object.Key && object.LastModified
          ? [{ key: object.Key, lastModified: object.LastModified }]
          : [],
      );
      if (page.length > 0) yield page;
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }

  destroy(): void {
    this.client.destroy();
  }
}

function isNotFound(error: unknown): boolean {
  if (error instanceof NoSuchKey) return true;
  return (
    error instanceof S3ServiceException &&
    (error.$metadata.httpStatusCode === 404 ||
      error.name === 'NotFound' ||
      error.name === 'NoSuchBucket')
  );
}
