import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { computeDedupeHash, type EmailProcessingJob } from '@repo/queue';
import { objectKeys } from '@repo/storage';
import { simpleParser } from 'mailparser';
import { EmailQueue } from '../core/email-queue.service.js';
import { StorageService } from '../core/storage.service.js';
import { RecipientResolver } from '../recipients/recipient-resolver.js';

/** An LMTP reply for one recipient: accepted, or refused with a reply code. */
export type DeliveryResult =
  { accepted: true } | { accepted: false; code: number; message: string };

const ACCEPTED: DeliveryResult = { accepted: true };
const tempFailure = (message: string): DeliveryResult => ({
  accepted: false,
  code: 451,
  message: `4.3.0 ${message}`,
});

/**
 * One delivered message, one or more recipients (README E8 to E15). For each recipient the
 * raw message is stored and a job queued; the worker does the rest. Recipients are answered
 * separately, so Postfix retries only the ones that failed for a temporary reason.
 */
@Injectable()
export class MessageIntake {
  private readonly logger = new Logger(MessageIntake.name);

  constructor(
    private readonly recipients: RecipientResolver,
    private readonly storage: StorageService,
    private readonly queue: EmailQueue,
  ) {}

  async deliver(raw: Buffer, recipients: string[]): Promise<DeliveryResult[]> {
    let dedupeHash: string;
    try {
      const parsed = await simpleParser(raw);
      dedupeHash = computeDedupeHash({
        messageId: parsed.messageId,
        text: parsed.text,
        html: parsed.html,
      });
    } catch (error) {
      return this.quarantine(raw, recipients, error as Error);
    }

    const receivedAt = new Date().toISOString();
    return Promise.all(
      recipients.map((address) =>
        this.deliverTo(address, raw, dedupeHash, receivedAt),
      ),
    );
  }

  private async deliverTo(
    address: string,
    raw: Buffer,
    dedupeHash: string,
    receivedAt: string,
  ): Promise<DeliveryResult> {
    let recipient;
    try {
      recipient = await this.recipients.resolve(address);
    } catch (error) {
      this.logger.error(
        `Lookup of ${address} failed: ${(error as Error).message}`,
      );
      return tempFailure('Temporary recipient lookup failure');
    }
    // The inbox can expire between Postfix's RCPT check and now.
    if (recipient.status !== 'live') {
      return {
        accepted: false,
        code: 550,
        message: '5.1.1 Mailbox unavailable',
      };
    }

    // One raw copy per recipient: the worker deletes its copy when it discards the mail.
    const rawObjectKey = objectKeys.raw(randomUUID());
    try {
      await this.storage.put(rawObjectKey, raw, 'message/rfc822');
    } catch (error) {
      this.logger.error(
        `Storing raw message failed: ${(error as Error).message}`,
      );
      return tempFailure('Temporary storage failure');
    }

    const job: EmailProcessingJob = {
      inboxId: recipient.inboxId,
      sessionId: recipient.sessionId,
      rawObjectKey,
      dedupeHash,
      receivedAt,
    };
    try {
      await this.queue.add(job);
    } catch (error) {
      this.logger.error(`Queueing failed: ${(error as Error).message}`);
      await this.storage.delete(rawObjectKey).catch(() => undefined);
      return tempFailure('Temporary queue failure');
    }
    return ACCEPTED;
  }

  /**
   * Mail that cannot be parsed is kept for inspection and accepted, not refused: refusing
   * would make Postfix bounce it to a sender address that is often forged (README R4).
   */
  private async quarantine(
    raw: Buffer,
    recipients: string[],
    error: Error,
  ): Promise<DeliveryResult[]> {
    const key = objectKeys.quarantine(randomUUID());
    try {
      await this.storage.put(key, raw, 'message/rfc822');
    } catch (storageError) {
      this.logger.error(
        `Quarantining failed: ${(storageError as Error).message}`,
      );
      return recipients.map(() => tempFailure('Temporary storage failure'));
    }
    this.logger.warn(`PARSE_FAILED: kept as ${key}: ${error.message}`);
    return recipients.map(() => ACCEPTED);
  }
}
