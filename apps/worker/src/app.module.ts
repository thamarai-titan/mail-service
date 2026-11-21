import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { ProcessingModule } from './processing/processing.module.js';

@Module({
  imports: [CoreModule, ProcessingModule, MaintenanceModule],
})
export class AppModule {}
