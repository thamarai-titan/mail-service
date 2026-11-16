import { createPrismaClient } from './index.js';

// Runs from packages/database (`pnpm db:seed`); the shared .env lives at the repository root.
for (const path of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(path);
  } catch {
    // Missing file: fall back to the process environment.
  }
}

const domainName = process.env['MAIL_DOMAIN'] ?? 'mail.localhost';
const prisma = createPrismaClient();

try {
  const domain = await prisma.domain.upsert({
    where: { name: domainName },
    update: { isActive: true },
    create: { name: domainName },
  });
  console.log(`Seeded domain ${domain.name} (${domain.id})`);
} finally {
  await prisma.$disconnect();
}
