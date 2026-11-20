import { Module } from '@nestjs/common';
import { EmailProcessor } from './email-processor.js';
import { ProcessingWorker } from './processing.worker.js';

@Module({
  providers: [EmailProcessor, ProcessingWorker],
})
export class ProcessingModule {}
