import { Module } from '@nestjs/common';
import { EventHub } from './event-hub.js';
import { EventPublisher } from './event-publisher.js';
import { EventStreamService } from './event-stream.service.js';
import { EventsController } from './events.controller.js';

@Module({
  controllers: [EventsController],
  providers: [EventHub, EventStreamService, EventPublisher],
  exports: [EventPublisher],
})
export class RealtimeModule {}
