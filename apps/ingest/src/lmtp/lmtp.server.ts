import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import {
  SMTPServer,
  type SMTPServerDataResult,
  type SMTPServerDataStream,
  type SMTPServerError,
} from 'smtp-server';
import { IngestConfig } from '../core/ingest-config.js';
import { RecipientResolver } from '../recipients/recipient-resolver.js';
import { MessageIntake, type DeliveryResult } from './message-intake.js';

function replyError(code: number, message: string): SMTPServerError {
  return Object.assign(new Error(message), { responseCode: code });
}

function toReply(result: DeliveryResult): SMTPServerDataResult {
  return result.accepted
    ? '2.0.0 Queued'
    : replyError(result.code, result.message);
}

/** Reads the whole message. Stops keeping bytes once it is over the limit. */
async function readMessage(stream: SMTPServerDataStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (!stream.sizeExceeded) chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * The LMTP listener Postfix delivers accepted mail to (README E7). It speaks only to the mail
 * server over a private link, so it offers no AUTH or TLS. Recipients are checked again at
 * RCPT TO, in case an inbox expired after Postfix's policy check.
 */
@Injectable()
export class LmtpServer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LmtpServer.name);
  private server: SMTPServer | undefined;

  constructor(
    private readonly config: IngestConfig,
    private readonly recipients: RecipientResolver,
    private readonly intake: MessageIntake,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const server = new SMTPServer({
      lmtp: true,
      banner: 'mail-service ingest',
      disabledCommands: ['AUTH', 'STARTTLS'],
      authOptional: true,
      size: this.config.maxMessageBytes,
      rejectOversized: true,
      logger: false,
      onRcptTo: (address, _session, callback) => {
        this.recipients.resolve(address.address).then(
          (recipient) =>
            callback(
              recipient.status === 'live'
                ? null
                : replyError(
                    550,
                    recipient.status === 'expired'
                      ? '5.1.1 Mailbox expired'
                      : '5.1.1 User unknown',
                  ),
            ),
          (error: Error) => {
            this.logger.error(`Recipient lookup failed: ${error.message}`);
            callback(
              replyError(451, '4.3.0 Temporary recipient lookup failure'),
            );
          },
        );
      },
      onData: (stream, session, callback) => {
        const recipients = session.envelope.rcptTo.map((r) => r.address);
        readMessage(stream)
          .then(async (raw) => {
            // The server answers 552 itself for an oversized message.
            if (stream.sizeExceeded) return callback(null);
            const results = await this.intake.deliver(raw, recipients);
            callback(null, results.map(toReply));
          })
          .catch((error: Error) => {
            this.logger.error(`Delivery failed: ${error.message}`);
            callback(replyError(451, '4.3.0 Temporary failure'));
          });
      },
    });
    server.on('error', (error) =>
      this.logger.error(`LMTP server: ${error.message}`),
    );
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.server.once('error', reject);
      server.listen(
        this.config.lmtpPort,
        this.config.listenHost,
        undefined,
        () => {
          server.server.off('error', reject);
          resolve();
        },
      );
    });
    this.logger.log(`LMTP on ${this.config.listenHost}:${this.port}`);
  }

  /** The bound port (differs from the configured one when that is 0, as in tests). */
  get port(): number {
    return (this.server?.server.address() as AddressInfo | null)?.port ?? 0;
  }

  /** Stops accepting connections and waits for deliveries in progress. */
  async onModuleDestroy(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
