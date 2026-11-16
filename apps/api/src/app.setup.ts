import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { AppConfig } from './config/app-config.js';

/** Application-wide HTTP settings, shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', app.get(AppConfig).trustProxyHops);
}
