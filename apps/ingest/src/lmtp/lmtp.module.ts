import { Module } from '@nestjs/common';
import { RecipientsModule } from '../recipients/recipients.module.js';
import { LmtpServer } from './lmtp.server.js';
import { MessageIntake } from './message-intake.js';

@Module({
  imports: [RecipientsModule],
  providers: [LmtpServer, MessageIntake],
})
export class LmtpModule {}
