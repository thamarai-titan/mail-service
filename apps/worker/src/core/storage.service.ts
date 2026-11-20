import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ObjectStorage } from '@repo/storage';
import { WorkerConfig } from './worker-config.js';

/** The object storage bucket for raw messages and attachments. Created on start if missing. */
@Injectable()
export class StorageService
  extends ObjectStorage
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: WorkerConfig) {
    super(config.storage);
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  onModuleDestroy(): void {
    this.destroy();
  }
}
