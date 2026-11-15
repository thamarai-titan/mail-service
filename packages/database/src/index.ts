import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';

/** Creates a Prisma client connected to PostgreSQL through the `pg` driver adapter. */
export function createPrismaClient(
  connectionString: string | undefined = process.env['DATABASE_URL'],
): PrismaClient {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
