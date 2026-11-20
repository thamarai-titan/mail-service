import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { AddressGenerator } from './address-generator.js';
import { AddressRegistry } from './address-registry.js';
import { InboxController } from './inbox.controller.js';
import { InboxService } from './inbox.service.js';

@Module({
  imports: [RealtimeModule],
  controllers: [InboxController],
  providers: [InboxService, AddressGenerator, AddressRegistry],
})
export class InboxModule {}
