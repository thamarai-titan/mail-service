// Development helper: drops sample messages into an existing inbox, standing in for real mail
// until the ingest and worker apps exist. Usage: pnpm db:fake-mail <address>
import './load-env.js';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './index.js';

const address = process.argv[2];
if (!address) {
  console.error('Usage: pnpm db:fake-mail <inbox address>');
  process.exit(1);
}

const prisma = createPrismaClient();

try {
  const inbox = await prisma.inbox.findUnique({ where: { address } });
  if (!inbox || inbox.status !== 'active' || inbox.expiresAt <= new Date()) {
    console.error(`No active inbox with the address ${address}`);
    process.exit(1);
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const samples = [
    {
      fromAddress: 'noreply@github.example',
      fromName: 'GitHub',
      subject: 'Your verification code',
      textBody: `Your verification code is ${otp}. It expires in 10 minutes.`,
      htmlSanitized: `<p>Your verification code is <strong>${otp}</strong>.</p><p>It expires in 10 minutes.</p>`,
      otpCode: otp,
      attachments: [],
    },
    {
      fromAddress: 'orders@shop.example',
      fromName: 'Example Shop',
      subject: 'Your order has shipped',
      textBody:
        'Hi there,\n\nGood news: your order #48213 is on its way. The invoice is attached.\n\nThanks for shopping with us.',
      htmlSanitized:
        '<h2>Your order has shipped</h2><p>Good news: your order <b>#48213</b> is on its way. The invoice is attached.</p>',
      otpCode: null,
      attachments: [
        {
          filename: 'invoice-48213.pdf',
          contentType: 'application/pdf',
          sizeBytes: 48213n,
          storageKey: `att/fake/${randomUUID()}`,
        },
        {
          filename: 'setup.exe',
          contentType: 'application/x-msdownload',
          sizeBytes: 912384n,
          storageKey: null,
          isBlocked: true,
        },
      ],
    },
    {
      fromAddress: 'friend@mail.example',
      fromName: null,
      subject: null,
      textBody:
        'Plain text only, no subject. Just checking this address works.',
      htmlSanitized: null,
      otpCode: null,
      attachments: [],
    },
  ];

  await prisma.$transaction(async (tx) => {
    for (const { attachments, ...sample } of samples) {
      const id = randomUUID();
      await tx.message.create({
        data: {
          ...sample,
          id,
          inboxId: inbox.id,
          dedupeHash: id,
          sizeBytes: BigInt(Buffer.byteLength(sample.textBody)),
          rawObjectKey: `raw/fake/${id}.eml`,
          attachments: { create: attachments },
        },
      });
    }
    await tx.inbox.update({
      where: { id: inbox.id },
      data: { messageCount: { increment: samples.length } },
    });
  });
  console.log(`Added ${samples.length} messages to ${address} (OTP ${otp})`);
} finally {
  await prisma.$disconnect();
}
