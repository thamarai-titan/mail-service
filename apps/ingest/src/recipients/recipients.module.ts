import { Module } from '@nestjs/common';
import { RecipientResolver } from './recipient-resolver.js';

@Module({
  providers: [RecipientResolver],
  exports: [RecipientResolver],
})
export class RecipientsModule {}
