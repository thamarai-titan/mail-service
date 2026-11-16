import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';

/** Constructor options that connect a Prisma client to PostgreSQL through the `pg` driver adapter. */
export function prismaClientOptions(
  connectionString: string | undefined = process.env['DATABASE_URL'],
): { adapter: PrismaPg } {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  return { adapter: new PrismaPg({ connectionString }) };
}

/** Creates a Prisma client connected to PostgreSQL through the `pg` driver adapter. */
export function createPrismaClient(connectionString?: string): PrismaClient {
  return new PrismaClient(prismaClientOptions(connectionString));
}
