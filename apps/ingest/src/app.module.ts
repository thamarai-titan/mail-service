import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { LmtpModule } from './lmtp/lmtp.module.js';
import { PolicyModule } from './policy/policy.module.js';

@Module({
  imports: [CoreModule, LmtpModule, PolicyModule],
})
export class AppModule {}
