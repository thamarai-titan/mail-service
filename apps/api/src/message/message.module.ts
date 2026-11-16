import { Module } from '@nestjs/common';
import { MessageController } from './message.controller.js';
import { MessageService } from './message.service.js';

@Module({
  controllers: [MessageController],
  providers: [MessageService],
})
export class MessageModule {}
