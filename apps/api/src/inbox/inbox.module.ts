import { Module } from '@nestjs/common';
import { AddressGenerator } from './address-generator.js';
import { AddressRegistry } from './address-registry.js';
import { InboxController } from './inbox.controller.js';
import { InboxService } from './inbox.service.js';

@Module({
  controllers: [InboxController],
  providers: [InboxService, AddressGenerator, AddressRegistry],
})
export class InboxModule {}
