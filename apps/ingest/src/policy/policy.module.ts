import { Module } from '@nestjs/common';
import { RecipientsModule } from '../recipients/recipients.module.js';
import { PolicyServer } from './policy.server.js';

@Module({
  imports: [RecipientsModule],
  providers: [PolicyServer],
})
export class PolicyModule {}
