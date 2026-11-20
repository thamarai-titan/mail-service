import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net';
import { IngestConfig } from '../core/ingest-config.js';
import { RecipientResolver } from '../recipients/recipient-resolver.js';
import {
  LOOKUP_FAILED_ACTION,
  PolicyRequestParser,
  policyResponse,
  recipientAction,
  type PolicyRequest,
} from './policy-protocol.js';

/** Postfix closes idle policy connections after 300 s by default; this is a backstop. */
const IDLE_TIMEOUT_MS = 10 * 60_000;

/**
 * The recipient check Postfix runs at RCPT TO (README E4, E5), so mail for unknown or expired
 * addresses is refused during the SMTP session and never bounces.
 */
@Injectable()
export class PolicyServer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PolicyServer.name);
  private readonly sockets = new Set<Socket>();
  private server: Server | undefined;

  constructor(
    private readonly config: IngestConfig,
    private readonly recipients: RecipientResolver,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const server = createServer((socket) => this.handle(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.config.policyPort, this.config.listenHost, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.logger.log(
      `Recipient policy service on ${this.config.listenHost}:${this.port}`,
    );
  }

  /** The bound port (differs from the configured one when that is 0, as in tests). */
  get port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? 0;
  }

  async onModuleDestroy(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }

  private handle(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding('utf8');
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy());
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => socket.destroy());

    const parser = new PolicyRequestParser();
    // Replies must go out in request order, so requests are answered one at a time.
    let queue = Promise.resolve();
    socket.on('data', (chunk: string) => {
      let requests: PolicyRequest[];
      try {
        requests = parser.feed(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const request of requests) {
        queue = queue.then(async () => {
          const action = await this.decide(request);
          if (!socket.destroyed) socket.write(policyResponse(action));
        });
      }
    });
  }

  private async decide(request: PolicyRequest): Promise<string> {
    const recipient = request['recipient'];
    // Only RCPT-stage checks for a recipient are this service's business.
    if (request['request'] !== 'smtpd_access_policy' || !recipient) {
      return 'DUNNO';
    }
    try {
      return recipientAction(await this.recipients.resolve(recipient));
    } catch (error) {
      this.logger.error(`Recipient lookup failed: ${(error as Error).message}`);
      return LOOKUP_FAILED_ACTION;
    }
  }
}
