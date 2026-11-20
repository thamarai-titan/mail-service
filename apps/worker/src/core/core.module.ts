import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';
import { StorageService } from './storage.service.js';
import { WorkerConfig } from './worker-config.js';

const providers = [WorkerConfig, PrismaService, RedisService, StorageService];

/** Configuration and connections shared by every worker module. */
@Global()
@Module({ providers, exports: providers })
export class CoreModule {}
