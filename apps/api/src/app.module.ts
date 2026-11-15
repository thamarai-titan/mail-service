import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AttachmentModule } from './attachment/attachment.module.js';
import { InboxModule } from './inbox/inbox.module.js';
import { MessageModule } from './message/message.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { SecurityModule } from './security/security.module.js';
import { SessionModule } from './session/session.module.js';

@Module({
  imports: [
    SecurityModule,
    SessionModule,
    InboxModule,
    MessageModule,
    AttachmentModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
