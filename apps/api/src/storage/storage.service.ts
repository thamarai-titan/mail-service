import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ObjectStorage } from '@repo/storage';
import { AppConfig } from '../config/app-config.js';

/** Read access to the object storage bucket. The worker creates the bucket and writes to it. */
@Injectable()
export class StorageService extends ObjectStorage implements OnModuleDestroy {
  constructor(config: AppConfig) {
    super(config.storage);
  }

  onModuleDestroy(): void {
    this.destroy();
  }
}
