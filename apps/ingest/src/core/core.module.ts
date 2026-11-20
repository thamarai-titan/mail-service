import { Global, Module } from '@nestjs/common';
import { EmailQueue } from './email-queue.service.js';
import { IngestConfig } from './ingest-config.js';
import { PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';
import { StorageService } from './storage.service.js';

const providers = [
  IngestConfig,
  PrismaService,
  RedisService,
  StorageService,
  EmailQueue,
];

/** Configuration and connections shared by every ingest module. */
@Global()
@Module({ providers, exports: providers })
export class CoreModule {}
