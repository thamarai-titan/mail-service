# Progress and Plan

Where the build stands and what comes next. The full system design is in [readme.md](readme.md); this file tracks how much of it exists.

**Last updated:** 21 Nov 2026, after Day 10.
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
| 8 | Ingest app (LMTP) | Done | `c79bac3` |
| 9 | Real mail: Postfix and DNS on the VPS | Done | `322063b` |
| 10 | Expiration and cleanup jobs | Done | |
| 11 | Production deployment and hardening | Next | |

What works today: open the dashboard, get an anonymous session, generate addresses, and read mail in a unified or per-address view. Mail delivered over LMTP goes through the ingest app and the worker and appears in the open dashboard within a second, with clean HTML, its OTP and downloadable attachments. The ingest app also answers Postfix's recipient check. Real mail arrives from the internet: Postfix on the VPS (`mx.ilotus.dev`) accepts mail for `@mail.ilotus.dev` and, until the app is deployed on Day 11, reaches the app on a laptop through an SSH tunnel. Expired inboxes leave the dashboard within a minute, and their mail is deleted within the hour.

## Running it locally

Needs Node 24+, pnpm 11 and Docker Desktop running.

```
cp .env.example .env    # first time only; then set SERVER_PEPPER to a random value
pnpm install
pnpm infra:up           # PostgreSQL, Redis and RustFS (object storage) in Docker
pnpm db:migrate         # apply migrations
pnpm db:seed            # insert the mail domain (mail.localhost)
pnpm dev                # web on :3000, API on :3001, plus the worker and ingest (LMTP :2525, policy :10040)
```

An `.env` created before Day 6 needs the `S3_*` lines from `.env.example`. One created before Day 8 also needs the `INGEST_*` lines, though the defaults match them.

Open `http://localhost:3000`, generate an address, then send it mail through the worker. It appears without a refresh:

```
pnpm mail:test <address> --lmtp                # through ingest over LMTP, the way Postfix delivers
pnpm mail:test <address>                       # straight onto the queue; only the worker needs to run
pnpm mail:test <address> message.eml --lmtp    # any .eml file
```

Without a file it sends a sample with an OTP, an inline image and two attachments. With `swaks` installed, `swaks --to <address> --server 127.0.0.1:2525 --protocol LMTP` works too.

To run a maintenance job now instead of waiting for its schedule (the worker must be running):

```
pnpm maintenance:run inbox-expiration     # or session-expiration, message-cleanup, attachment-cleanup, failed-job-retry
```

`pnpm db:fake-mail <address>` still inserts three messages straight into the database, without the worker. Its attachments are not in storage, so downloading them gives a 404.

Checks:

```
pnpm check-types && pnpm lint
pnpm --filter api test         # unit tests
pnpm --filter api test:e2e     # needs infra:up and db:seed
pnpm --filter worker test
pnpm --filter worker test:e2e  # needs infra:up and db:seed; stop pnpm dev first
pnpm --filter ingest test
pnpm --filter ingest test:e2e  # needs infra:up and db:seed
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
- Every live address is registered in Redis under `addr:<address>` with the inbox's expiry. The ingest app's recipient check reads it.
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

### Day 8: ingest app

- [apps/ingest](apps/ingest/src/) runs two listeners for Postfix on `INGEST_HOST`, which defaults to `127.0.0.1`. Neither has authentication or TLS, so they must stay on loopback or the private link to the mail server.
- **LMTP on port 2525** (`lmtp:inet:host:2525` in Postfix):
  - Recipients are checked again at `RCPT TO`, in case an inbox expired after Postfix's check.
  - At `DATA` the message is parsed once to compute the dedupe hash.
  - Each accepted recipient gets its own raw copy in `raw/` and its own job. Separate copies matter because the worker deletes its copy when it discards mail for a gone inbox.
  - LMTP answers each recipient separately, so Postfix retries only the ones that failed:

    | Case | Reply |
    |---|---|
    | Queued | `250 2.0.0 Queued` |
    | Inbox gone by `DATA` | `550 5.1.1` |
    | Lookup, storage or queue failure | `451 4.3.0`; Postfix keeps the mail and retries. A raw copy whose job could not be queued is deleted. |
    | Over `MAX_MESSAGE_BYTES` (10 MB) | `552` |
    | Cannot be parsed | Kept in `quarantine/` and answered 250, so nothing bounces to a forged sender. A `451` if even the quarantine upload fails. |

- **Postfix policy service on port 10040** (`check_policy_service inet:host:10040`):
  - It speaks the Postfix policy delegation protocol.
  - A live address gets `DUNNO`. Unknown addresses get `550 5.1.1 User unknown`, and expired ones `550 5.1.1 Mailbox expired`. A lookup failure gets `451 4.3.0`.
  - Many requests can share one connection.
- **Recipient lookup:**
  - It reads `addr:<address>` in Redis.
  - On a miss, or while Redis is down, it asks PostgreSQL. That is how it tells expired from unknown, and a live inbox missing from Redis is written back.
  - Addresses are matched case-insensitively.
- Redis commands in ingest fail at once while Redis is down (no offline queue), and adding a job times out after 5 seconds. A delivery then gets `451` instead of hanging.
- The `addr:` key helpers moved to [@repo/queue](packages/queue/src/addresses.ts), and the API uses them too.
- Checked: in headless Chrome, a message sent with `pnpm mail:test <address> --lmtp` appeared in the dashboard about 0.2 seconds after the command finished.
- Code: [apps/ingest/src/](apps/ingest/src/).

### Day 9: real mail

Addresses will be `@mail.ilotus.dev`. The apex `ilotus.dev` already has a website and name.com mail forwarding, so it is left alone. Postfix runs on the VPS host as `mx.ilotus.dev`; there is one VPS, so the app will run beside it and no WireGuard link is needed. The full guide is [infra/postfix/README.md](infra/postfix/README.md).

Done:

- [setup.sh](infra/postfix/setup.sh) installs and configures Postfix with `postconf`, so it can be re-run:
  - receive-only, with no local delivery and no outbound mail, so nothing bounces to forged senders;
  - relays `mail.ilotus.dev` to ingest over LMTP;
  - checks recipients with the policy service, and answers `451` if ingest cannot be reached;
  - postscreen, without the deep tests that delay first-time senders;
  - 10 MB limit, rate limits, opportunistic TLS;
  - retries every 1 to 5 minutes for 2 hours.
- Checked in an Ubuntu 24.04 container against the local app:
  - mail to a live inbox went through postscreen, STARTTLS and LMTP and was stored with its OTP;
  - an unknown address got `550 5.1.1`, a relay attempt `554` and an 11 MB message `552`;
  - with ingest unreachable, recipients got `451`.
- `pnpm db:seed` now deactivates every domain except `MAIL_DOMAIN`, so new addresses use the seeded domain. Inboxes on the old domain keep receiving until they expire.

- On the VPS (Ubuntu 24.04, Terapeer):
  - DNS is live at name.com: `A mx`, `MX mail → mx.ilotus.dev`, SPF `-all` on `mail` and `mx`, DMARC `p=reject` on `_dmarc.mail`.
  - `setup.sh` ran; port 25 had been closed by ufw and the script opened it. Port 25 answers from the internet as `mx.ilotus.dev`.
  - The app runs on a laptop with `MAIL_DOMAIN=mail.ilotus.dev`, reached through an SSH reverse tunnel (README step 4).
- Checked: a message sent from Gmail arrived in the dashboard.

Left over:

- Reverse DNS (PTR) for the VPS IP still points to the provider's name; ask Terapeer to set it to `mx.ilotus.dev`.
- STARTTLS uses the self-signed certificate. Port 80 is closed in ufw, so certbot has not run yet.

### Day 10: expiration and cleanup

Five BullMQ job schedulers in the worker ([apps/worker/src/maintenance/](apps/worker/src/maintenance/)). Each job has its own queue and runs one at a time per worker process. Every job is idempotent and works in batches of 500, so a missed or doubled run does no harm. Schedules and retention times are in [maintenance-settings.ts](apps/worker/src/maintenance/maintenance-settings.ts).

| Job | Runs | What it does |
|---|---|---|
| `inbox-expiration` | every minute | Marks inboxes past `expires_at` as `expired`, deletes their `addr:` keys and publishes `INBOX_EXPIRED` to the session |
| `session-expiration` | every 15 minutes | Marks idle sessions `expired` with their live inboxes (and deletes those `addr:` keys). Deletes sessions 7 days after expiry, which cascades to their inboxes and events |
| `message-cleanup` | hourly | Deletes the messages of expired or deleted inboxes, with their raw files and attachments in storage. Inbox rows stay until their session is deleted |
| `attachment-cleanup` | daily, 03:00 UTC | Sweeps `raw/` and `att/` for files no row refers to and older than 24 hours, and deletes `quarantine/` files older than 7 days |
| `failed-job-retry` | every 10 minutes | Re-queues dead-letter jobs whose failure was temporary |

- The storage sweep never deletes a raw file that a queued, retrying, failed or dead-letter job still points to.
- It catches:
  - raw copies of duplicates that BullMQ skipped;
  - files of messages deleted one at a time in the dashboard;
  - files left over when a run stopped halfway.
- Dead letters:
  - The processing worker now records whether a failure is `retryable`. A missing or unparseable raw file is not.
  - `failed-job-retry` puts a retryable job back with fresh attempts, at most 3 times; the count is kept in the job's `replays` field.
  - If the failed job has already aged out of BullMQ, it queues a new one from the saved data.
  - Entries older than 7 days are dropped.
- `pnpm maintenance:run <job>` queues a job immediately.
- Checked against the running app:
  - An inbox with one message was pushed past its expiry. The open event stream received `INBOX_EXPIRED` 22 seconds later, at the next run.
  - The inbox left the list, and its `addr:` key was gone.
  - `message-cleanup` then deleted the message and its 2 stored files.
- Tests: [maintenance.e2e-spec.ts](apps/worker/test/maintenance.e2e-spec.ts) covers each job, including keeping live data and young files.

### Dashboard redesign

- Tailwind CSS v4 and shadcn/ui (Radix, `nova` preset) replace the CSS modules. Animations use `motion`. Components live in [apps/web/components/app/](apps/web/components/app/), and the shadcn primitives in `components/ui/`.
- **Visual language**, inspired by [ui.wensity.com](https://ui.wensity.com/):
  - dark by default, on true neutral surfaces with one soft honey accent (it replaced a red that was hard on the eyes) and no gradients on controls;
  - large two-tone headlines and monospace labels;
  - panels set in a darker shell ([frame.tsx](apps/web/components/app/frame.tsx));
  - buttons with a hairline top highlight;
  - a faint film grain, and a red glow at the top of the page.
  - The colour tokens are in [globals.css](apps/web/app/globals.css).
- Name and search copy in one place: [lib/brand.ts](apps/web/lib/brand.ts). The working name is **Inboxhive**, "a hive of inboxes", and the logo is three honeycomb cells. The title, description and headings carry the searched terms ("temp mail", "temporary email", "disposable email").
- **Layout:** app first, stacked top to bottom.
  - A small two-line title: "Temp mail for testers" (the page's H1) and a description that names the 10-address limit.
  - The address ticket.
  - The address chips, when there are several addresses.
  - The inbox, at one fixed screen-sized height in every state, so the page below never moves when mail arrives or a message opens or closes. While no message is open, the list uses the full width with one line per message, and an empty inbox shows "Waiting for mail" centred. Opening a message splits the inbox into list and email, scrolled to fill the screen.
  - The big headline and marketing copy sit below the app.
- **Address ticket** ([address-ticket.tsx](apps/web/components/app/address-ticket.tsx)): the address is the ticket, and the actions sit on a stub behind a perforated tear line with punched notches.
  - Ticket side: the ticket number and "valid until" time, and Delete, which asks first.
  - Stub side:
    - Copy address;
    - a countdown button that opens "Keep this address for" (1, 6, 12 or 24 hours), each with the exact time it keeps the address until;
    - New, whose menu makes up to 5 at once.
- **Pinned address:** once the ticket scrolls out of view, the address and a copy button ride along in the sticky top bar.
- **Live indicator:** a small signal waveform with "receiving", flat and red while reconnecting.
- **Keyboard shortcuts** are listed in the footer. Toasts sit bottom-right.
- **Address chips:** a "your addresses N/10" panel. The chips sit on one line: "All inboxes" stays fixed on the left and the addresses scroll sideways (a mouse wheel scrolls them too), each with its time left and unread count. The selected chip is a soft amber tint. "copy all N" copies every address, one per line.
- `PATCH /api/inboxes/:id/extend` accepts `{ "hours": 1 | 6 | 12 | 24 }`: keep the inbox until that many hours from now, capped at 24 hours after creation and never shortened. Without a body it still adds one hour.
- **First visit:** an address is created automatically.
- **Codes:** an inverted chip in the list. In the open message, each character sits in its own cell, animated in, with "Copy code".
- **Verification links:** the viewer finds the "confirm your email" link in a message and shows its host with an "Open link" button.
- **New mail opens by itself** on a wide screen when no message is open.
- **Keyboard shortcuts**:
  - `j` / `k`: next / previous message;
  - `c`: copy the address;
  - `y`: copy the code;
  - `n`: new address;
  - `Esc`: close the message.
- **New mail:**
  - a toast with the sender and code, with a "Copy code" or "Open" action;
  - the unread count in the tab title;
  - optional desktop notifications while the tab is in the background (the bell in the top bar).
- **Micro-interactions:** new mail slides in with a brief glow, copy icons spring into a tick, and the selected address highlight glides. Skeletons replace "Loading…". Reduced-motion settings turn the animations off.
- **Screen sizes:** on a phone, one pane at a time with a back button.
- **For search engines:** below the app sit an editorial "How it works", feature showcases with illustrated previews, a spec row, an FAQ, and WebApplication and FAQPage JSON-LD. The page is prerendered as static HTML.
- Checked in headless Chrome at 1440, 900 and 390 px, dark and light: a first visit, a message opened, and a toast for mail delivered while the page was open.

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
| Attachment rules enforced by both ingest and worker | Enforced by the worker | The worker is where files are uploaded; ingest only checks size and that the mail parses |
| Recipient policy as an HTTP endpoint, `/policy/recipient` | A TCP service speaking Postfix's policy delegation protocol | `check_policy_service` speaks that protocol, not HTTP |
| MIME depth and part-count limits during parsing | Not built; the 10 MB size limit is the only bound | mailparser has no option for them; revisit if hostile mail causes trouble |
| `NEW_EMAIL` carries sender, subject, OTP and time, and the dashboard shows a toast | It carries `inboxId` and `messageId`; the dashboard refetches the affected lists and shows no toast | The lists already show those fields; a toast can be added later without changing the API |
| SSE gateway keeps a map from session to connections | The same, plus a limit of 5 streams per session and a 30-minute stream lifetime | Bounds memory per session, and makes an expired session stop receiving events |
| Separate mail and app VPS joined by WireGuard | One VPS: Postfix on the host, ingest on its loopback | Only one server is available; ingest's ports never leave loopback |
| Addresses on the main domain | Addresses on `mail.ilotus.dev` | `ilotus.dev` already has a website and mail forwarding |
| message-cleanup deletes mail of dead inboxes after a retention window | Deleted at the next hourly run, with no extra window | Nobody can open an expired or deleted inbox, so keeping its mail serves no one |
| failed-job-retry re-queues retryable DLQ jobs | The same, at most 3 times per job; unrecoverable failures stay in the DLQ for 7 days | A job that keeps failing would otherwise loop every 10 minutes |

## Not built yet

- The CSRF check (required `X-Requested-With` header on mutations) and the general limit of 60 requests per minute.
- Alerts when the dead-letter queue is not empty (the design uses Alertmanager).
- Helmet and CORS settings.

## Plan for the coming days

### Day 11: production deployment and hardening

- Production Docker Compose and Nginx configuration: TLS and rate limits. For `/api/events`: `proxy_buffering off` and a read timeout above 30 minutes, so streams end on the server's schedule.
- Set `NODE_ENV=production` (turns on the cookie's `Secure` flag) and `TRUST_PROXY_HOPS=1`.
- CSRF header check, Helmet, the 60 requests per minute limit.
- A strong `SERVER_PEPPER` and real database and Redis passwords, kept out of images.

## Things that are easy to trip over

- **Each open dashboard tab holds one event stream.** A session can hold 5; a sixth tab gets 429 and falls back to polling every 30 seconds while it retries.
- **The worker must be running for `pnpm mail:test` mail to appear, and ingest too with `--lmtp`.** `pnpm dev` starts both. Queued jobs wait in Redis until the worker runs.
- **A Redis `addr:` key can outlive its inbox when a session is deleted directly in the database** (as tests do). Ingest then accepts the mail and the worker discards it, which is harmless. `inbox-expiration` deletes such keys once the inbox's time is up.
- **The RustFS credentials are the ones in `docker-compose.dev.yml`.** Changing `S3_ACCESS_KEY` or `S3_SECRET_KEY` in `.env` alone breaks storage.
- **Rate limits during local testing.** 5 sessions per hour per IP and 20 inbox creations per hour. To reset: `docker exec mail-service-dev-redis-1 sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`.
- **`TRUST_PROXY_HOPS` must be 1 behind Nginx.** Otherwise every user shares one IP for the rate limits.
- **Changing `SERVER_PEPPER` logs everyone out.** Stored token hashes no longer match.
- **The e2e tests use the development database and Redis.** They clean up their own rows and clear all `rl:*` counters.
- **The maintenance jobs act on the whole development database and bucket**, the worker e2e tests included. The `failed-job-retry` test drops every dead-letter entry.
- **Two 401 responses on the first page load are expected.** They are what triggers session creation.
- **Next.js and Turborepo are newer than most documentation.** Read the docs bundled in `node_modules` before changing their configuration; see [AGENTS.md](AGENTS.md).
