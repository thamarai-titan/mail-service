import { Module } from '@nestjs/common';
import { AttachmentModule } from './attachment/attachment.module.js';
import { ExpirationModule } from './expiration/expiration.module.js';
import { OtpModule } from './otp/otp.module.js';
import { ProcessingModule } from './processing/processing.module.js';

@Module({
  imports: [ProcessingModule, OtpModule, ExpirationModule, AttachmentModule],
})
export class AppModule {}
