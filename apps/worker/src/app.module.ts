import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { ExpirationModule } from './expiration/expiration.module.js';
import { ProcessingModule } from './processing/processing.module.js';

@Module({
  imports: [CoreModule, ProcessingModule, ExpirationModule],
})
export class AppModule {}
