import './load-env.js';
import { createPrismaClient } from './index.js';

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
