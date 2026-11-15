import { Module } from '@nestjs/common';
import { IngestionModule } from './ingestion/ingestion.module.js';

@Module({
  imports: [IngestionModule],
})
export class AppModule {}
