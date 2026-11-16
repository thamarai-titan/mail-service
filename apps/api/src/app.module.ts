import { Module } from '@nestjs/common';
import { AttachmentModule } from './attachment/attachment.module.js';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { InboxModule } from './inbox/inbox.module.js';
import { MessageModule } from './message/message.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RedisModule } from './redis/redis.module.js';
import { SecurityModule } from './security/security.module.js';
import { SessionModule } from './session/session.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    SecurityModule,
    SessionModule,
    InboxModule,
    MessageModule,
    AttachmentModule,
    RealtimeModule,
  ],
})
export class AppModule {}
