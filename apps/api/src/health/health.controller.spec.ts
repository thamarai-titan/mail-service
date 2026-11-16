import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RedisService } from '../redis/redis.service.js';

function controllerWith(database: () => Promise<unknown>, redis: () => Promise<unknown>) {
  return new HealthController(
    { $queryRaw: database } as unknown as PrismaService,
    { ping: redis } as unknown as RedisService,
  );
}

describe('HealthController', () => {
  it('reports ok when PostgreSQL and Redis both answer', async () => {
    const controller = controllerWith(
      () => Promise.resolve([{ '?column?': 1 }]),
      () => Promise.resolve('PONG'),
    );

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('responds 503 naming the dependency that is down', async () => {
    const controller = controllerWith(
      () => Promise.resolve([{ '?column?': 1 }]),
      () => Promise.reject(new Error('ECONNREFUSED')),
    );

    const error = await controller.check().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'degraded',
      checks: { database: 'up', redis: 'down' },
    });
  });
});
