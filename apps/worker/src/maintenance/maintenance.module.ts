import { Module } from '@nestjs/common';
import { FailedJobRetry } from './failed-job-retry.js';
import { InboxExpiration } from './inbox-expiration.js';
import { MaintenanceQueues } from './maintenance-queues.js';
import { MaintenanceScheduler } from './maintenance.scheduler.js';
import { MessageCleanup } from './message-cleanup.js';
import { SessionExpiration } from './session-expiration.js';
import { StorageCleanup } from './storage-cleanup.js';

/** Scheduled jobs: expiration, cleanup and dead-letter retries (README section 8). */
@Module({
  providers: [
    MaintenanceQueues,
    InboxExpiration,
    SessionExpiration,
    MessageCleanup,
    StorageCleanup,
    FailedJobRetry,
    MaintenanceScheduler,
  ],
})
export class MaintenanceModule {}
