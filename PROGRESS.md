# Progress and Plan

Where the build stands and what comes next. The full system design is in [readme.md](readme.md); this file tracks how much of it exists.

**Last updated:** 20 Nov 2026, after Day 7.
**Branch:** all work below is on `main`. From Day 6 onward, work continues directly on `main`.

## Status at a glance

| Day | Goal | Status | Commit |
|---|---|---|---|
| 1 | Local infrastructure, first migration, API health check | Done | `64923aa` |
| 2 | Anonymous sessions | Done | `01a6143` |
| 3 | Inboxes: generate, list, extend, delete | Done | `556346c` |
| 4 | Message read API | Done | `2c70e9a` |
| 5 | Web dashboard | Done | `96c627b` |
| 6 | Worker pipeline | Done | `7c5fd45` |
| 7 | Realtime updates (SSE) | Done | `18b2824` |
| 8 | Ingest app (LMTP) | Next | |
| 9 | Real mail: Postfix and DNS on the VPS | To do | |
| 10 | Expiration and cleanup jobs | To do | |
| 11 | Production deployment and hardening | To do | |

What works today: open the dashboard, get an anonymous session, generate addresses, and read mail in a unified or per-address view. A queued email goes through the worker and appears in the open dashboard within a second, with clean HTML, its OTP and downloadable attachments. Mail does not arrive from the internet yet: `pnpm mail:test` queues one by hand.

## Running it locally

Needs Node 24+, pnpm 11 and Docker Desktop running.

```
cp .env.example .env    # first time only; then set SERVER_PEPPER to a random value
pnpm install
pnpm infra:up           # PostgreSQL, Redis and RustFS (object storage) in Docker
pnpm db:migrate         # apply migrations
pnpm db:seed            # insert the mail domain (mail.localhost)
pnpm dev                # web on :3000, API on :3001, plus the worker
```

An `.env` created before Day 6 needs the `S3_*` lines from `.env.example`.

Open `http://localhost:3000`, generate an address, then send it mail through the worker. It appears without a refresh:

```
pnpm mail:test <address>                # a sample with an OTP, an inline image and two attachments
pnpm mail:test <address> message.eml    # any .eml file
```

`pnpm db:fake-mail <address>` still inserts three messages straight into the database, without the worker. Its attachments are not in storage, so downloading them gives a 404.

Checks:

```
pnpm check-types && pnpm lint
pnpm --filter api test         # unit tests
pnpm --filter api test:e2e     # needs infra:up and db:seed
pnpm --filter worker test
pnpm --filter worker test:e2e  # needs infra:up and db:seed
```

The [bruno/](bruno/) folder is a Bruno collection of every API request. Open the folder in Bruno and pick the `local` environment. Run "Create session" first; Bruno keeps the cookie for the other requests.

## What is built

### Day 1: local infrastructure

- [infra/docker/docker-compose.dev.yml](infra/docker/docker-compose.dev.yml) runs PostgreSQL 17 and Redis 7, bound to localhost.
- One `.env` at the repository root is read by the API and by the Prisma CLI.
- First migration applied from [schema.prisma](packages/database/prisma/schema.prisma); the seed inserts the `MAIL_DOMAIN` row.
- The API has global config, Prisma and Redis modules. `GET /api/health` returns 200 when PostgreSQL and Redis answer and 503 otherwise.

### Day 2: anonymous sessions

- `POST /api/sessions` creates a session and sets the `sid` cookie (HttpOnly, SameSite=Strict, path `/api`). `GET /api/sessions/me` returns the current session.
- The token is 256 random bits. PostgreSQL stores only its HMAC-SHA256 under `SERVER_PEPPER`.
- `SessionGuard` checks a 5-minute Redis cache first and falls back to PostgreSQL. The 24-hour expiry slides at most once every 5 minutes.
- One IP can create 5 sessions per hour.
- Code: [apps/api/src/session/](apps/api/src/session/). Other routes use `@UseGuards(SessionGuard)` and `@CurrentSession()`.

### Day 3: inboxes

- `POST /api/inboxes` (`count` 1 to 5), `GET /api/inboxes`, `PATCH /api/inboxes/:id/extend`, `DELETE /api/inboxes/:id`.
- Addresses are 12 random characters on the seeded domain and live for 60 minutes. Extending adds an hour, up to 24 hours after creation.
- A session can hold 10 active inboxes. The quota check locks the session row, so concurrent requests cannot exceed it.
- 20 creations per hour per session and per IP.
- Every live address is registered in Redis under `addr:<address>` with the inbox's expiry. The SMTP recipient check will read this.
- Code: [apps/api/src/inbox/](apps/api/src/inbox/).

### Day 4: message read API

- `GET /api/messages` lists 50 per page, newest first, for all inboxes (`view=unified`, the default) or one (`inboxId=`). `nextCursor` goes back as `cursor`.
- `GET /api/messages/:id` returns the bodies and attachment metadata and marks the message read. `DELETE /api/messages/:id` removes it.
- Every query is filtered by the session id, so another session's inbox or message is a 404.
- `pnpm db:fake-mail <address>` stands in for real mail until Days 6 and 8.
- Code: [apps/api/src/message/](apps/api/src/message/).

### Day 5: web dashboard

- Three panes: address sidebar, message list, email viewer. One column on a phone. Follows the system light or dark theme.
- The session is created automatically on the first 401.
- HTML mail renders in a sandboxed iframe with a Content Security Policy that blocks scripts and network requests. Remote images load only after "Show images".
- The web app proxies `/api/*` to the API (`API_ORIGIN`, default `http://localhost:3001`), so the cookie is same-origin and no CORS setup is needed.
- Code: [apps/web/components/](apps/web/components/), [apps/web/hooks/](apps/web/hooks/), [apps/web/lib/api.ts](apps/web/lib/api.ts).

### Day 6: worker pipeline

- RustFS 1.0.4 runs in Docker as the S3 server on `localhost:9000`. The worker creates the bucket on start. [packages/storage](packages/storage/src/index.ts) holds the client and the key layout: `raw/`, `att/`, `quarantine/`.
- [packages/queue](packages/queue/src/index.ts) defines the job payload, the retry options and the dedupe hash: SHA-256 of the Message-ID and the body. The BullMQ job id is `<inboxId>.<dedupeHash>`, since BullMQ ids cannot contain `:`.
- For each job the worker:
  - skips duplicates;
  - checks that the inbox is still live and belongs to the job's session;
  - reads and parses the raw `.eml`;
  - sanitizes the HTML;
  - applies the attachment rules and uploads the allowed files;
  - extracts the OTP;
  - writes the message, attachments, `RECEIVED` and `OTP_EXTRACTED` events and the inbox count in one transaction;
  - publishes `NEW_EMAIL` on `events:session:<id>`.
- HTML: scripts, forms, frames, `<style>` blocks and event handlers are removed, and links open in a new tab with no referrer. Inline `cid:` images become `data:` URIs.
- Attachments: at most 5 MB each and 10 stored per message. Executables, scripts, disk images and macro-enabled Office files are blocked by extension or content type. A blocked file keeps its row so the reader sees it was removed.
- Failures: 5 attempts with backoff from 2 seconds. A missing or unparseable raw file fails at once. Either way the job ends up in `email-processing-dlq` and is logged as a `FAILED` event.
- An inbox that expired or was deleted after the mail was accepted: the message and its files are discarded.
- `GET /api/attachments/:id/download` streams the file as a download, with `nosniff`, a sandbox CSP and `no-store`. Blocked attachments return 403 `ATTACHMENT_BLOCKED`. Another session's attachment is a 404. The dashboard links each allowed attachment to it.
- Code: [apps/worker/src/](apps/worker/src/), [apps/api/src/attachment/](apps/api/src/attachment/), [send-test-mail.ts](apps/worker/src/dev/send-test-mail.ts).

### Day 7: live updates

- `GET /api/events` is a server-sent event stream for the session. One Redis `PSUBSCRIBE events:session:*` per API process fans events out to that process's open streams.
- Each event is `id: <email_events.id>`, `event: <type>` and `data: <JSON>`. Events with no stored row, such as `INBOX_DELETED`, have no `id` line, so the browser's `Last-Event-ID` stays on the last stored event.
- On reconnect, `NEW_EMAIL` events after `Last-Event-ID` are replayed from `email_events`, up to 100. Live events that arrive during the replay are held back and sent after it, so nothing is missed or sent twice.
- A heartbeat comment goes out every 25 seconds, and `retry: 3000` sets the reconnect delay. The headers `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` keep proxies from buffering.
- Each stream closes after 30 minutes. The browser reconnects at once, which runs `SessionGuard` again, so an expired session stops receiving events. A session can hold 5 streams; a sixth gets 429 `TOO_MANY_STREAMS`.
- `DELETE /api/inboxes/:id` publishes `INBOX_DELETED`, so the session's other tabs drop the inbox.
- Dashboard ([use-live-updates.ts](apps/web/hooks/use-live-updates.ts)):
  - It subscribes after the first successful request, so the session cookie exists.
  - `NEW_EMAIL` refetches the unified list, that inbox's list and the inbox counts.
  - `INBOX_DELETED` and `INBOX_EXPIRED` remove the inbox from the cache.
  - After any reconnect it refetches everything once.
  - If the server refuses the stream, for example because the session expired, it calls `/sessions/me` to get a new session and retries with backoff up to 30 seconds.
- The 5-second polling is gone. Lists poll every 30 seconds only while the stream is down.
- Checked in headless Chrome:
  - New mail appeared about 0.1 seconds after the send command finished, with one refetch of the messages and one of the inboxes.
  - A deletion from another tab showed in about 0.1 seconds.
  - After an API restart, mail stored while the API was down appeared about 3 seconds after it came back.
- Code: [apps/api/src/realtime/](apps/api/src/realtime/), [apps/web/hooks/use-live-updates.ts](apps/web/hooks/use-live-updates.ts).

## Differences from the design

| Design says | What was built | Why |
|---|---|---|
| A separate `OwnershipGuard` | Every query is filtered by session id | Same 404 result without a second lookup |
| Reserved-word check on addresses | Not built | A random 12-character address cannot equal `postmaster` or `admin` |
| Create and list return a bare list | They return `{ "inboxes": [...] }` | Leaves room to add fields later |
| NestJS Throttler with a Redis store | A small Redis counter in [rate-limiter.ts](apps/api/src/security/rate-limiter.ts) | Fewer dependencies; same limits |
| MinIO for local object storage | RustFS | MinIO's images can no longer be pulled from Docker Hub or Quay |
| Ingest parses the mail and passes a `parsedRef` to the worker | The worker reads the raw `.eml` and parses it itself | One stored copy of each message, and any job can be replayed from the raw file |
| OTP extraction as a separate `otp-extraction` child job | Extracted inside the processing job, saved in the same transaction | It is a fast regex pass; a second queue would delay `NEW_EMAIL` and add a failure point |
| Attachment rules enforced by both ingest and worker | Enforced by the worker | The worker is where files are uploaded; ingest will only check size and that the mail parses |
| `NEW_EMAIL` carries sender, subject, OTP and time, and the dashboard shows a toast | It carries `inboxId` and `messageId`; the dashboard refetches the affected lists and shows no toast | The lists already show those fields; a toast can be added later without changing the API |
| SSE gateway keeps a map from session to connections | The same, plus a limit of 5 streams per session and a 30-minute stream lifetime | Bounds memory per session, and makes an expired session stop receiving events |

## Not built yet

- The CSRF check (required `X-Requested-With` header on mutations) and the general limit of 60 requests per minute.
- The `INBOX_EXPIRED` event. The dashboard already handles it; the expiration job on Day 10 will publish it.
- A toast for new mail.
- Expired inboxes are hidden by every query, but no job marks them expired or deletes their data yet.
- Nothing re-queues jobs from the dead-letter queue yet (`failed-job-retry`, Day 10).
- Nothing deletes stored objects yet. A raw file uploaded for a duplicate that BullMQ then skips is left behind until the cleanup jobs on Day 10.
- Helmet and CORS settings.

## Plan for the coming days

### Day 8: ingest app

Build the LMTP server in [apps/ingest](apps/ingest) (design section 4, steps E8 to E15).

- Accept a message over LMTP, store the raw `.eml`, parse it with mailparser, apply attachment rules, resolve the inbox, enqueue the job.
- The recipient policy endpoint Postfix will call, backed by the `addr:` keys in Redis.
- Move the `addr:` key helper from the API into a shared package so ingest uses the same one.
- Queue jobs with `EMAIL_PROCESSING_JOB_OPTIONS` and `emailProcessingJobId` from `@repo/queue`, as [send-test-mail.ts](apps/worker/src/dev/send-test-mail.ts) does.

Done when a message sent to the local LMTP port with `swaks` lands in the dashboard.

### Day 9: real mail on the VPS

A domain and a VPS are already available. Needed before starting: the domain name, the VPS provider, and confirmation that the provider allows inbound port 25.

- Postfix configuration in [infra/postfix](infra/postfix): postscreen, recipient check at `RCPT TO`, 10 MB size limit, LMTP hand-off to ingest.
- DNS: MX record, plus SPF and DMARC records that reject mail claiming to come from the domain (it only receives).
- Seed the real domain in place of `mail.localhost`.

Done when an email sent from a real service arrives in the dashboard.

### Day 10: expiration and cleanup

- Jobs for inbox expiration, session expiration, message cleanup and attachment cleanup (design section 8).
- Publish `INBOX_EXPIRED`.

Done when an expired inbox disappears from the dashboard on its own and its data is removed.

### Day 11: production deployment and hardening

- Production Docker Compose and Nginx configuration: TLS and rate limits. For `/api/events`: `proxy_buffering off` and a read timeout above 30 minutes, so streams end on the server's schedule.
- Set `NODE_ENV=production` (turns on the cookie's `Secure` flag) and `TRUST_PROXY_HOPS=1`.
- CSRF header check, Helmet, the 60 requests per minute limit.
- A strong `SERVER_PEPPER` and real database and Redis passwords, kept out of images.

## Things that are easy to trip over

- **Each open dashboard tab holds one event stream.** A session can hold 5; a sixth tab gets 429 and falls back to polling every 30 seconds while it retries.
- **The worker must be running for `pnpm mail:test` mail to appear.** `pnpm dev` starts it. Queued jobs wait in Redis until it does.
- **The RustFS credentials are the ones in `docker-compose.dev.yml`.** Changing `S3_ACCESS_KEY` or `S3_SECRET_KEY` in `.env` alone breaks storage.
- **Rate limits during local testing.** 5 sessions per hour per IP and 20 inbox creations per hour. To reset: `docker exec mail-service-dev-redis-1 sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`.
- **`TRUST_PROXY_HOPS` must be 1 behind Nginx.** Otherwise every user shares one IP for the rate limits.
- **Changing `SERVER_PEPPER` logs everyone out.** Stored token hashes no longer match.
- **The e2e tests use the development database and Redis.** They clean up their own rows and clear all `rl:*` counters.
- **Two 401 responses on the first page load are expected.** They are what triggers session creation.
- **Next.js and Turborepo are newer than most documentation.** Read the docs bundled in `node_modules` before changing their configuration; see [AGENTS.md](AGENTS.md).
