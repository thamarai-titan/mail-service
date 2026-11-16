import { Global, Module } from '@nestjs/common';
import { SessionCreationLimitGuard } from './session-creation-limit.guard.js';
import { SessionController } from './session.controller.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

// Global so every feature module can put SessionGuard on its routes.
@Global()
@Module({
  controllers: [SessionController],
  providers: [SessionService, SessionGuard, SessionCreationLimitGuard],
  exports: [SessionService, SessionGuard],
})
export class SessionModule {}
