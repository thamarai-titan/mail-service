import type { INestApplication } from '@nestjs/common';

/** Application-wide HTTP settings, shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
}
