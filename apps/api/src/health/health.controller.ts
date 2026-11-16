import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const CHECK_TIMEOUT_MS = 2000;

type CheckStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: { database: CheckStatus; redis: CheckStatus };
}

async function probe(check: () => Promise<unknown>): Promise<CheckStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 200 when PostgreSQL and Redis both answer, 503 with the same body otherwise. */
  @Get()
  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(() => this.redis.ping()),
    ]);
    const healthy = database === 'up' && redis === 'up';
    const report: HealthReport = {
      status: healthy ? 'ok' : 'degraded',
      checks: { database, redis },
    };
    if (!healthy) {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
