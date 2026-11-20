# Progress and Plan

Where the build stands and what comes next. The full system design is in [readme.md](readme.md); this file tracks how much of it exists.

**Last updated:** 20 Nov 2026, after Day 5.
**Branch:** all work below is on `main`. From Day 6 onward, work continues directly on `main`.

## Status at a glance

| Day | Goal | Status | Commit |
|---|---|---|---|
| 1 | Local infrastructure, first migration, API health check | Done | `64923aa` |
| 2 | Anonymous sessions | Done | `01a6143` |
| 3 | Inboxes: generate, list, extend, delete | Done | `556346c` |
| 4 | Message read API | Done | `2c70e9a` |
| 5 | Web dashboard | Done | `96c627b` |
| 6 | Worker pipeline | Next | |
| 7 | Realtime updates (SSE) | To do | |
| 8 | Ingest app (LMTP) | To do | |
| 9 | Real mail: Postfix and DNS on the VPS | To do | |
| 10 | Expiration and cleanup jobs | To do | |
| 11 | Production deployment and hardening | To do | |

What works today: open the dashboard, get an anonymous session, generate addresses, and read mail in a unified or per-address view. Mail does not arrive from the internet yet; sample messages are inserted with a helper script.

## Running it locally

Needs Node 24+, pnpm 11 and Docker Desktop running.

```
cp .env.example .env    # first time only; then set SERVER_PEPPER to a random value
pnpm install
pnpm infra:up           # PostgreSQL and Redis in Docker
pnpm db:migrate         # apply migrations
pnpm db:seed            # insert the mail domain (mail.localhost)
pnpm dev                # web on :3000, API on :3001
```

Open `http://localhost:3000`, generate an address, then simulate incoming mail:

```
pnpm db:fake-mail <address>    # adds three sample messages; they appear within 5 seconds
```

Checks:

```
pnpm check-types && pnpm lint
pnpm --filter api test         # unit tests
pnpm --filter api test:e2e     # needs infra:up and db:seed
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

## Differences from the design

| Design says | What was built | Why |
|---|---|---|
| A separate `OwnershipGuard` | Every query is filtered by session id | Same 404 result without a second lookup |
| Reserved-word check on addresses | Not built | A random 12-character address cannot equal `postmaster` or `admin` |
| Create and list return a bare list | They return `{ "inboxes": [...] }` | Leaves room to add fields later |
| NestJS Throttler with a Redis store | A small Redis counter in [rate-limiter.ts](apps/api/src/security/rate-limiter.ts) | Fewer dependencies; same limits |
| MinIO for local object storage | Nothing yet | MinIO's images can no longer be pulled from Docker Hub or Quay |
| Live updates over SSE | The dashboard polls every 5 seconds | Temporary, until Day 7 |

## Not built yet

- Object storage, and therefore attachment download and raw `.eml` storage. RustFS and SeaweedFS images are both available as a MinIO replacement; one has to be chosen on Day 6.
- The CSRF check (required `X-Requested-With` header on mutations) and the general limit of 60 requests per minute.
- The `INBOX_DELETED` and `INBOX_EXPIRED` events.
- Expired inboxes are hidden by every query, but no job marks them expired or deletes their data yet.
- Helmet and CORS settings.

## Plan for the coming days

### Day 6: worker pipeline

Build the BullMQ consumer in [apps/worker](apps/worker) (design section 4, steps W1 to W7).

- Choose and add the local object storage server; implement the S3 client in [packages/storage](packages/storage).
- Define the `email-processing` job payload in [packages/queue](packages/queue).
- Worker: skip duplicates, check the inbox is still active, sanitize HTML, upload attachments, write the message, attachments and event in one transaction, extract the OTP, publish `NEW_EMAIL` to Redis.
- Retries: 5 attempts with exponential backoff, then a dead-letter queue.
- Attachment download endpoint in the API.

Done when a job enqueued by hand becomes a message in the dashboard.

### Day 7: realtime updates

- `GET /api/events` as an SSE stream per session, fed by Redis Pub/Sub, with a 25-second heartbeat and `Last-Event-ID` replay from `email_events`.
- The dashboard subscribes and refreshes the affected lists; remove the 5-second polling.
- Publish `INBOX_DELETED`.

Done when a new message appears without a refresh or a poll.

### Day 8: ingest app

Build the LMTP server in [apps/ingest](apps/ingest) (design section 4, steps E8 to E15).

- Accept a message over LMTP, store the raw `.eml`, parse it with mailparser, apply attachment rules, resolve the inbox, enqueue the job.
- The recipient policy endpoint Postfix will call, backed by the `addr:` keys in Redis.
- Move the `addr:` key helper from the API into a shared package so ingest uses the same one.

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

- Production Docker Compose and Nginx configuration: TLS, rate limits, unbuffered SSE.
- Set `NODE_ENV=production` (turns on the cookie's `Secure` flag) and `TRUST_PROXY_HOPS=1`.
- CSRF header check, Helmet, the 60 requests per minute limit.
- A strong `SERVER_PEPPER` and real database and Redis passwords, kept out of images.

## Things that are easy to trip over

- **Rate limits during local testing.** 5 sessions per hour per IP and 20 inbox creations per hour. To reset: `docker exec mail-service-dev-redis-1 sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`.
- **`TRUST_PROXY_HOPS` must be 1 behind Nginx.** Otherwise every user shares one IP for the rate limits.
- **Changing `SERVER_PEPPER` logs everyone out.** Stored token hashes no longer match.
- **The e2e tests use the development database and Redis.** They clean up their own rows and clear all `rl:*` counters.
- **Two 401 responses on the first page load are expected.** They are what triggers session creation.
- **Next.js and Turborepo are newer than most documentation.** Read the docs bundled in `node_modules` before changing their configuration; see [AGENTS.md](AGENTS.md).
