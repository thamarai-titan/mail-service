import './load-env.js';
import { createPrismaClient } from './index.js';

const domainName = (process.env['MAIL_DOMAIN'] ?? 'mail.localhost').toLowerCase();
const prisma = createPrismaClient();

try {
  // MAIL_DOMAIN is the domain new addresses use, so every other domain is switched off.
  // Inboxes already created on those domains keep receiving mail until they expire.
  const [domain, deactivated] = await prisma.$transaction([
    prisma.domain.upsert({
      where: { name: domainName },
      update: { isActive: true },
      create: { name: domainName },
    }),
    prisma.domain.updateMany({
      where: { name: { not: domainName }, isActive: true },
      data: { isActive: false },
    }),
  ]);
  console.log(`Seeded domain ${domain.name} (${domain.id})`);
  if (deactivated.count > 0) {
    console.log(`Deactivated ${deactivated.count} other domain(s); new addresses use ${domain.name}`);
  }
} finally {
  await prisma.$disconnect();
}
