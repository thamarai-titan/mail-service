import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, prismaClientOptions } from '@repo/database';
import { WorkerConfig } from './worker-config.js';

/** The shared Prisma client. Connects lazily on first query. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: WorkerConfig) {
    super(prismaClientOptions(config.databaseUrl));
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
