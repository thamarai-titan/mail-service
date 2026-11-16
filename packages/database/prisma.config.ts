import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The Prisma CLI runs from this package; the shared .env lives at the repository root.
config({ path: ['.env', '../../.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node dist/seed.js',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
