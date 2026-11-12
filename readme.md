# Multi-Inbox Temporary Email Platform — System Design Whiteboard

> Self-hosted, anonymous, multi-inbox disposable email (Temp-Mail style).
> **Differentiator:** one anonymous session owns many live addresses at once, all feeding a **Unified Inbox** in real time.

**Stack:** Next.js · NestJS · PostgreSQL · Redis · BullMQ · Postfix · mailparser · SSE · TanStack Query · Docker Compose · Nginx · S3-compatible object storage

---

## 0. Legend and Architecture at a Glance

```mermaid
flowchart LR
  L1["Frontend"]:::fe
  L2["Backend / NestJS"]:::be
  L3[("Database / Storage")]:::db
  L4["Email Infrastructure"]:::mail
  L5[["Queue / Workers"]]:::queue
  L6["Infrastructure / Deployment"]:::infra
  L7{"Security check / Decision"}:::sec
  L8["Error / Rejection path"]:::err

  classDef fe fill:#E3F2FD,stroke:#1565C0,color:#0D47A1,stroke-width:2px
  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
  classDef mail fill:#FFF3E0,stroke:#E65100,color:#BF360C,stroke-width:2px
  classDef queue fill:#FFEBEE,stroke:#C62828,color:#B71C1C,stroke-width:2px
  classDef infra fill:#ECEFF1,stroke:#455A64,color:#263238,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
  classDef err fill:#FFCDD2,stroke:#B71C1C,color:#B71C1C,stroke-width:2px
```

```mermaid
flowchart LR
  subgraph CLIENT["Client Layer"]
    USER(("User")):::fe
    WEB["Next.js App<br/>Dashboard · Unified Inbox"]:::fe
  end
  subgraph EDGE["Edge"]
    NGX["Nginx<br/>TLS · rate limit · routing"]:::infra
  end
  subgraph APP["Application Layer"]
    API["NestJS API<br/>REST + SSE"]:::be
    WRK[["NestJS Workers<br/>BullMQ consumers"]]:::queue
  end
  subgraph MAIL["Email Receiving Layer"]
    EXT["External Sender"]:::mail
    PFX["Postfix SMTP :25"]:::mail
    ING["Ingestion Service<br/>LMTP + mailparser"]:::mail
  end
  subgraph DATA["Data Layer"]
    PG[("PostgreSQL")]:::db
    RD[("Redis<br/>BullMQ · Pub/Sub · cache")]:::queue
    S3[("Object Storage<br/>raw .eml · attachments")]:::db
  end

  USER --> WEB --> NGX --> API
  API <--> PG
  API <--> RD
  EXT -->|"SMTP"| PFX -->|"LMTP"| ING
  ING -->|"enqueue"| RD
  ING --> S3
  RD -->|"jobs"| WRK
  WRK --> PG
  WRK --> S3
  WRK -->|"PUBLISH events"| RD
  API -->|"SSE push"| WEB

  classDef fe fill:#E3F2FD,stroke:#1565C0,color:#0D47A1,stroke-width:2px
  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
  classDef mail fill:#FFF3E0,stroke:#E65100,color:#BF360C,stroke-width:2px
  classDef queue fill:#FFEBEE,stroke:#C62828,color:#B71C1C,stroke-width:2px
  classDef infra fill:#ECEFF1,stroke:#455A64,color:#263238,stroke-width:2px
```

---

## 1. User / Frontend Layer

### 1a. User Journey

```mermaid
flowchart TD
  F1["F1 · User opens website"]:::fe --> D1{"sid cookie present<br/>and valid?"}:::sec
  D1 -->|"No"| F2["F2 · POST /api/sessions<br/>create anonymous session"]:::be
  F2 --> F3["F3 · Receive secure session token<br/>Set-Cookie sid · HttpOnly · Secure · SameSite=Strict"]:::sec
  D1 -->|"Yes"| F4
  F3 --> F4["F4 · Open Dashboard<br/>GET /api/inboxes · open SSE /api/events"]:::fe
  F4 --> F5["F5 · Click Generate Inbox<br/>POST /api/inboxes count=1"]:::fe
  F5 --> F6["F6 · Generate multiple addresses<br/>POST /api/inboxes count=N"]:::fe
  F6 --> F7["F7 · All inboxes listed in sidebar<br/>address · countdown · copy · delete"]:::fe
  F7 --> D2{"View mode?"}:::sec
  D2 -->|"Unified"| F8a["F8a · Unified Inbox<br/>all inboxes merged, newest first"]:::fe
  D2 -->|"Single"| F8b["F8b · Individual Inbox<br/>one selected inbox only"]:::fe
  F8a --> F9["F9 · Email Viewer<br/>sanitized HTML · OTP · attachments"]:::fe
  F8b --> F9

  classDef fe fill:#E3F2FD,stroke:#1565C0,color:#0D47A1,stroke-width:2px
  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
```

### 1b. Frontend Component Tree

```mermaid
flowchart TB
  APP["Next.js App Router"]:::fe
  APP --> PROV["Providers<br/>QueryClientProvider · SessionBootstrap · SSEProvider"]:::fe
  PROV --> DATA["Data layer<br/>apiClient with credentials include<br/>TanStack Query · useEventStream hook"]:::fe
  PROV --> DASH["Dashboard"]:::fe
  DASH --> SIDE["Inbox Sidebar"]:::fe
  DASH --> PANE["Message Pane"]:::fe
  DASH --> VIEW["Email Viewer"]:::fe

  SIDE --> GEN["Generate Inbox Button<br/>+ bulk count selector 1 to 5"]:::fe
  SIDE --> UNL["Unified Inbox entry<br/>total unread badge"]:::fe
  SIDE --> ITEM["Inbox List Item x N"]:::fe
  ITEM --> COPY["Copy Email Button<br/>navigator.clipboard"]:::fe
  ITEM --> CD["Expiration Countdown<br/>client timer from expiresAt"]:::fe
  ITEM --> DEL["Delete Inbox Button<br/>DELETE /api/inboxes/:id"]:::fe

  PANE --> UNI["Unified Inbox<br/>queryKey: messages, unified"]:::fe
  PANE --> IND["Individual Inbox<br/>queryKey: messages, inbox, id"]:::fe

  VIEW --> FRAME["Sandboxed iframe srcdoc<br/>CSP · remote images blocked by default"]:::sec
  VIEW --> OTP["OTP Extractor badge<br/>one-click copy"]:::fe
  VIEW --> ATT["Attachment List<br/>short-lived presigned download"]:::fe

  classDef fe fill:#E3F2FD,stroke:#1565C0,color:#0D47A1,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
```

| Component | Data source | Notes |
|---|---|---|
| Inbox Sidebar | `GET /api/inboxes` → `['inboxes']` | Updated by `setQueryData` after create/delete and by SSE events |
| Unified Inbox | `GET /api/messages?view=unified&cursor=` | Infinite query, each row shows the originating address chip |
| Individual Inbox | `GET /api/messages?inboxId=:id&cursor=` | Same list component, filtered |
| Email Viewer | `GET /api/messages/:id` | Marks read, renders `html_sanitized` in sandboxed iframe |
| Expiration Countdown | `expiresAt` from inbox payload | Purely client-side, server event `INBOX_EXPIRED` is the source of truth |

---

## 2. Anonymous Session Management

### 2a. Session Creation and Validation

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (Next.js)
  participant N as Nginx
  participant API as NestJS Session Module
  participant R as Redis
  participant PG as PostgreSQL

  B->>N: GET /api/sessions/me (no cookie)
  N->>API: forward
  API-->>B: 401 NO_SESSION
  B->>N: POST /api/sessions
  N->>API: forward (IP rate limit: 5 sessions per hour)
  API->>API: token = crypto.randomBytes(32) as base64url (256-bit)
  API->>API: tokenHash = HMAC-SHA256(token, SERVER_PEPPER)
  API->>PG: INSERT AnonymousSessions (id, token_hash, expires_at = now + 24h)
  API->>R: SET sess:tokenHash = sessionId EX 300
  API-->>B: 201 sessionId, expiresAt + Set-Cookie sid=token HttpOnly Secure SameSite=Strict
  Note over B,PG: Raw token lives only in the HttpOnly cookie. PostgreSQL stores the hash only.

  B->>N: GET /api/inboxes (Cookie sid)
  N->>API: forward
  API->>API: SessionGuard hashes cookie value
  API->>R: GET sess:tokenHash
  alt cache hit
    R-->>API: sessionId
  else cache miss
    API->>PG: SELECT id, expires_at, status WHERE token_hash = hash
    PG-->>API: row or null
  end
  alt missing, expired or revoked
    API-->>B: 401 SESSION_INVALID (frontend creates a new session)
  else valid
    API->>PG: touch last_seen_at, slide expires_at (throttled to once per 5 min)
    API-->>B: 200 data scoped to session_id
  end
```

### 2b. Ownership Model

```mermaid
flowchart LR
  S1(("Anonymous<br/>Session S1")):::be
  S1 --> I1["Inbox 1"]:::be
  S1 --> I2["Inbox 2"]:::be
  S1 --> I3["Inbox 3"]:::be
  S1 --> IN["Inbox N"]:::be
  I1 --> M11["Message 1"]:::db
  I1 --> M12["Message 2"]:::db
  I2 --> M21["Message 1"]:::db
  I3 --> M31["Message 1"]:::db
  I3 --> M32["Message 2"]:::db
  M12 --> A1["Attachment"]:::db

  S2(("Anonymous<br/>Session S2")):::be
  S2 --> I9["Inbox 9"]:::be
  S2 --x|"isolated: no access"| I1
  S1 --x|"isolated: no access"| I9

  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
```

### 2c. Authorization Check on Every Request

```mermaid
flowchart TD
  R0["Incoming API request"]:::be --> D1{"sid cookie<br/>present?"}:::sec
  D1 -->|"No"| E1["401 NO_SESSION"]:::err
  D1 -->|"Yes"| H["HMAC-SHA256 of token"]:::sec
  H --> D2{"Session row found,<br/>status active,<br/>expires_at in future?"}:::sec
  D2 -->|"No"| E2["401 SESSION_INVALID"]:::err
  D2 -->|"Yes"| CTX["req.session = id"]:::be
  CTX --> D3{"Route targets a<br/>specific inbox or message?"}:::sec
  D3 -->|"No: list endpoints"| Q1["Query always filtered by<br/>WHERE inboxes.session_id = req.session.id"]:::be
  D3 -->|"Yes"| D4{"OwnershipGuard:<br/>resource.inbox.session_id<br/>equals req.session.id?"}:::sec
  D4 -->|"No"| E3["404 NOT_FOUND<br/>never 403, no existence leak"]:::err
  D4 -->|"Yes"| OK["Handler executes"]:::be
  Q1 --> OK

  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
  classDef err fill:#FFCDD2,stroke:#B71C1C,color:#B71C1C,stroke-width:2px
```

---

## 3. Inbox Generation Workflow

### 3a. Single and Bulk Generation (same endpoint)

```mermaid
flowchart TD
  G1["G1 · User clicks Generate Inbox<br/>or picks bulk count N"]:::fe
  G2["G2 · POST /api/inboxes<br/>body: count 1 to 5, domainId optional"]:::fe
  D1{"G3 · SessionGuard<br/>session valid?"}:::sec
  E1["401 → re-create session"]:::err
  D2{"G4 · ThrottlerGuard<br/>under 20 creations per hour<br/>per session and per IP?"}:::sec
  E2["429 Too Many Requests<br/>Retry-After header"]:::err
  D3{"G5 · Quota check<br/>lock session row FOR UPDATE<br/>active + N within 10?"}:::sec
  E3["409 QUOTA_EXCEEDED<br/>returns remaining slots"]:::err
  D4{"G6 · Domain active?"}:::sec
  E4["422 DOMAIN_UNAVAILABLE"]:::err
  G7["G7 · For i = 1..N<br/>localPart = 12 chars, crypto random<br/>alphabet a-z 2-9 minus l, o, 0, 1 · about 60 bits"]:::be
  D5{"Reserved word?<br/>postmaster, abuse, admin..."}:::sec
  G8["G8 · Build rows<br/>session_id · domain_id · expires_at = now + 60 min"]:::be
  G9["G9 · One transaction<br/>INSERT ... ON CONFLICT address DO NOTHING RETURNING"]:::db
  D6{"All N rows<br/>inserted?"}:::sec
  G10["Regenerate the missing ones<br/>max 3 retries"]:::be
  G11["G11 · Redis pipeline<br/>HSET addr:ADDRESS inboxId sessionId expiresAt<br/>EXPIREAT = inbox expiry"]:::queue
  G12["G12 · 201 Created<br/>list of id, address, expiresAt"]:::be
  G13["G13 · setQueryData inboxes<br/>sidebar updates · countdowns start · newest selected"]:::fe

  G1 --> G2 --> D1
  D1 -->|"No"| E1
  D1 -->|"Yes"| D2
  D2 -->|"No"| E2
  D2 -->|"Yes"| D3
  D3 -->|"No"| E3
  D3 -->|"Yes"| D4
  D4 -->|"No"| E4
  D4 -->|"Yes"| G7 --> D5
  D5 -->|"Yes: regenerate"| G7
  D5 -->|"No"| G8 --> G9 --> D6
  D6 -->|"No: collision"| G10 --> G9
  D6 -->|"Yes"| G11 --> G12 --> G13

  classDef fe fill:#E3F2FD,stroke:#1565C0,color:#0D47A1,stroke-width:2px
  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
  classDef queue fill:#FFEBEE,stroke:#C62828,color:#B71C1C,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
  classDef err fill:#FFCDD2,stroke:#B71C1C,color:#B71C1C,stroke-width:2px
```

### 3b. Bulk Example: User Requests 5 Inboxes

```mermaid
flowchart LR
  B1["B1 · User requests 5"]:::fe --> B2{"B2 · Quota:<br/>active 3 + 5 within 10?"}:::sec
  B2 -->|"Yes"| B3["B3 · Generate 5 unique addresses"]:::be
  B2 -->|"No"| BX["409 · only 7 slots left"]:::err
  B3 --> B4[("B4 · Save all 5 in one transaction")]:::db
  B4 --> B5["B5 · Register 5 addresses in Redis"]:::queue
  B5 --> B6["B6 · Return inbox list"]:::be
  B6 --> B7["B7 · Dashboard shows 8 inboxes"]:::fe

  classDef fe fill:#E3F2FD,stroke:#1565C0,color:#0D47A1,stroke-width:2px
  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
  classDef queue fill:#FFEBEE,stroke:#C62828,color:#B71C1C,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
  classDef err fill:#FFCDD2,stroke:#B71C1C,color:#B71C1C,stroke-width:2px
```

---

## 4. Email Receiving Infrastructure (Core Pipeline)

```mermaid
flowchart TD
  subgraph EXTZ["External"]
    E1["E1 · External Sender MTA<br/>to: abc123@yourdomain.com"]:::mail
  end
  subgraph DNSZ["DNS"]
    E2["E2 · MX lookup<br/>yourdomain.com MX 10 mx.yourdomain.com"]:::infra
  end

  subgraph MTA["Mail Server VPS · Postfix"]
    E3["E3 · postscreen + smtpd :25<br/>STARTTLS · connection rate limits"]:::mail
    D0{"Client passes RBL,<br/>pregreet and rate checks?"}:::sec
    E4["E4 · RCPT TO stage<br/>check_policy_service"]:::mail
    E5["E5 · Recipient Policy Service<br/>Redis HGETALL addr:ADDRESS<br/>fallback PostgreSQL"]:::mail
    D1{"Address exists?"}:::sec
    D2{"Inbox active and<br/>expiresAt in future?"}:::sec
    E6["E6 · DATA stage"]:::mail
    D3{"Size within<br/>message_size_limit 10 MB?"}:::sec
    E7["E7 · LMTP handoff<br/>transport lmtp:inet:ingest:2525"]:::mail
  end

  R0["421 / 554 reject<br/>connection dropped"]:::err
  R1["550 5.1.1 User unknown<br/>rejected at RCPT, no bounce"]:::err
  R2["550 5.1.1 Mailbox expired"]:::err
  R3["552 5.3.4 Message too large"]:::err

  subgraph INGZ["Email Ingestion Service · NestJS + LMTP"]
    E8["E8 · Stream raw .eml<br/>to object storage raw/ · TTL 7 days"]:::mail
    E9["E9 · Parse MIME<br/>mailparser simpleParser<br/>limits: depth, part count"]:::mail
    D4{"Parse OK?"}:::sec
    E10["E10 · Validate headers<br/>and attachments: count, size, type"]:::mail
    D5{"All attachments<br/>allowed?"}:::sec
    E11["E11 · Strip blocked attachments<br/>keep metadata, is_blocked = true"]:::mail
    E12["E12 · Resolve inbox<br/>address → inbox_id, session_id"]:::mail
    E13["E13 · dedupe_hash =<br/>SHA-256 of Message-ID + body"]:::mail
    E14["E14 · Enqueue BullMQ job<br/>queue email-processing<br/>jobId = inboxId:dedupeHash"]:::queue
    D6{"Enqueue OK?"}:::sec
    E15["E15 · LMTP 250 OK"]:::mail
  end

  R4["Quarantine raw .eml<br/>log PARSE_FAILED · metric<br/>reply 250, no backscatter"]:::err
  R5["LMTP 451 4.3.0 temporary failure<br/>Postfix keeps mail and retries"]:::err

  subgraph QZ["Redis · BullMQ"]
    Q1[["email-processing queue"]]:::queue
  end

  subgraph WZ["Email Processing Worker"]
    W1["W1 · Pick up job"]:::queue
    D7{"Duplicate?<br/>UNIQUE inbox_id + dedupe_hash"}:::sec
    D8{"Inbox still active?<br/>race with expiry"}:::sec
    W2["W2 · Sanitize HTML<br/>sanitize-html allowlist<br/>strip scripts, forms, event handlers"]:::queue
    W3["W3 · Upload attachments<br/>object storage att/"]:::queue
    W4["W4 · DB transaction<br/>INSERT Messages, Attachments,<br/>EmailEvents RECEIVED"]:::db
    D9{"DB write OK?"}:::sec
    D10{"Attempts left?<br/>max 5, exponential backoff"}:::sec
    W5["W5 · OTP extraction job<br/>regex patterns + keyword scoring"]:::queue
    W6["W6 · UPDATE Messages.otp_code<br/>EmailEvent OTP_EXTRACTED"]:::db
    W7["W7 · PUBLISH Redis<br/>events:session:SESSION_ID<br/>NEW_EMAIL"]:::queue
  end

  R6["Ack and drop<br/>EmailEvent DUPLICATE"]:::err
  R7["Discard, delete raw object<br/>log EXPIRED_ON_ARRIVAL"]:::err
  R8["Dead-letter queue<br/>alert · raw kept for replay"]:::err

  subgraph RTZ["Real-time Delivery"]
    RT1["RT1 · NestJS SSE Gateway<br/>subscribed to events:session:*"]:::be
    RT2["RT2 · Authenticated session stream<br/>event NEW_EMAIL"]:::be
    RT3["RT3 · Browser EventSource<br/>TanStack Query invalidation"]:::fe
    RT4["RT4 · New email displayed"]:::fe
  end

  E1 --> E2 --> E3 --> D0
  D0 -->|"No"| R0
  D0 -->|"Yes"| E4 --> E5 --> D1
  D1 -->|"No"| R1
  D1 -->|"Yes"| D2
  D2 -->|"No"| R2
  D2 -->|"Yes"| E6 --> D3
  D3 -->|"No"| R3
  D3 -->|"Yes"| E7 --> E8 --> E9 --> D4
  D4 -->|"No"| R4
  D4 -->|"Yes"| E10 --> D5
  D5 -->|"No"| E11 --> E12
  D5 -->|"Yes"| E12
  E12 --> E13 --> E14 --> D6
  D6 -->|"No: Redis down"| R5
  D6 -->|"Yes"| E15
  E14 --> Q1 --> W1 --> D7
  D7 -->|"Yes"| R6
  D7 -->|"No"| D8
  D8 -->|"No"| R7
  D8 -->|"Yes"| W2 --> W3 --> W4 --> D9
  D9 -->|"No"| D10
  D10 -->|"Yes: retry"| Q1
  D10 -->|"No"| R8
  D9 -->|"Yes"| W5 --> W6 --> W7 --> RT1 --> RT2 --> RT3 --> RT4

  classDef fe fill:#E3F2FD,stroke:#1565C0,color:#0D47A1,stroke-width:2px
  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
  classDef mail fill:#FFF3E0,stroke:#E65100,color:#BF360C,stroke-width:2px
  classDef queue fill:#FFEBEE,stroke:#C62828,color:#B71C1C,stroke-width:2px
  classDef infra fill:#ECEFF1,stroke:#455A64,color:#263238,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
  classDef err fill:#FFCDD2,stroke:#B71C1C,color:#B71C1C,stroke-width:2px
```

### Failure Handling Matrix

| Condition | Detected at | Response to sender | Internal action |
|---|---|---|---|
| Recipient does not exist | Postfix RCPT TO via policy service | `550 5.1.1` reject in-session | Metric `smtp_rcpt_unknown`; no bounce generated (rejecting during SMTP avoids backscatter) |
| Inbox expired | Policy service (expiresAt check) | `550 5.1.1` | Address key already removed by expiration job; worker re-checks in case of race |
| Email too large | Postfix `message_size_limit` (also ESMTP SIZE at MAIL FROM) | `552 5.3.4` | Ingestion also enforces a streaming byte cap as a second line of defense |
| MIME parsing fails | Ingestion service | `250` accepted | Raw .eml moved to `quarantine/`, `PARSE_FAILED` logged, alert if rate spikes |
| Duplicate email | BullMQ jobId + DB unique index `(inbox_id, dedupe_hash)` | `250` | Acked and dropped, `DUPLICATE` event logged |
| Queue unavailable | Ingestion enqueue | `451 4.3.0` temp failure | Postfix keeps message in its own queue and retries |
| Database storage fails | Worker transaction | already `250` | BullMQ retries (5 attempts, exponential backoff from 2s), then DLQ + alert; raw .eml kept for replay |

---

## 5. Multi-Inbox and Unified Inbox Architecture

```mermaid
flowchart LR
  subgraph SENDERS["External senders"]
    X1["github.com"]:::mail
    X2["shop.example"]:::mail
    X3["bank.example"]:::mail
  end

  subgraph SA["Anonymous Session S1 · same browser"]
    IA["Inbox A<br/>k7q2mz9xw4ht@yourdomain.com<br/>3 emails"]:::be
    IB["Inbox B<br/>p4tr8vwcn6je@yourdomain.com<br/>5 emails"]:::be
    IC["Inbox C<br/>h2nd6yjeq8fs@yourdomain.com<br/>2 emails"]:::be
  end

  subgraph SB["Anonymous Session S2 · different user"]
    IDD["Inbox D<br/>4 emails"]:::be
  end

  MT[("Messages table<br/>every row carries inbox_id")]:::db

  UQ["M1 · GET /api/messages?view=unified<br/>JOIN Inboxes WHERE session_id = S1"]:::be
  SORT["M2 · ORDER BY received_at DESC<br/>cursor pagination, 50 per page"]:::be
  UI["M3 · UNIFIED INBOX · 10 messages<br/>each row shows originating address chip"]:::fe
  CLICK["M4 · User clicks a message"]:::fe
  VW["M5 · Email Viewer<br/>GET /api/messages/:id, ownership checked"]:::fe

  SEL["M6 · User selects Inbox B"]:::fe
  OWN{"Inbox B owned<br/>by S1?"}:::sec
  NF["404 Not Found"]:::err
  IQ["M7 · GET /api/messages?inboxId=B<br/>WHERE inbox_id = B AND session_id = S1"]:::be
  IUI["M8 · INDIVIDUAL INBOX B · 5 messages"]:::fe

  X1 --> IA
  X2 --> IB
  X3 --> IB
  X1 --> IC
  IA --> MT
  IB --> MT
  IC --> MT
  IDD --> MT
  MT --> UQ --> SORT --> UI --> CLICK --> VW
  MT --> SEL --> OWN
  OWN -->|"No"| NF
  OWN -->|"Yes"| IQ --> IUI --> CLICK
  UQ --x|"S2 rows never match"| IDD

  classDef fe fill:#E3F2FD,stroke:#1565C0,color:#0D47A1,stroke-width:2px
  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
  classDef mail fill:#FFF3E0,stroke:#E65100,color:#BF360C,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
  classDef err fill:#FFCDD2,stroke:#B71C1C,color:#B71C1C,stroke-width:2px
```

**Isolation rule:** the session id never comes from the client. It is always derived server-side from the cookie, and every message query is joined through `Inboxes.session_id`. Index `messages (inbox_id, received_at DESC)` plus `inboxes (session_id, status)` keeps the unified query fast.

---

## 6. Backend Architecture (NestJS Monorepo, 3 Deployable Apps)

```mermaid
flowchart TB
  subgraph APIAPP["apps/api · HTTP process · app VPS"]
    SEC["Security / Rate Limit Module<br/>SessionGuard · OwnershipGuard<br/>ThrottlerGuard · Helmet · CORS"]:::sec
    SESS["Session Module<br/>create · validate · touch · revoke"]:::be
    INB["Inbox Module<br/>generate · bulk · list · delete · extend"]:::be
    MSG["Message Module<br/>unified and per-inbox queries · mark read"]:::be
    ATTA["Attachment Module<br/>presigned download URLs"]:::be
    RT["Real-time Events Module<br/>SSE controller · Redis subscriber<br/>connection registry"]:::be
  end

  subgraph INGAPP["apps/ingest · LMTP process · mail VPS"]
    INGM["Email Ingestion Module<br/>LMTP server · recipient policy endpoint<br/>mailparser · validation · enqueue"]:::mail
  end

  subgraph WKAPP["apps/worker · BullMQ process · app VPS"]
    PROC["Email Processing Module<br/>dedupe · sanitize · persist"]:::queue
    OTPM["OTP Extraction Module<br/>pattern library + scoring"]:::queue
    EXP["Expiration Module<br/>inbox · session · cleanup schedulers"]:::queue
    ATTW["Attachment Module<br/>upload · delete objects"]:::queue
  end

  subgraph LIBS["libs · shared code"]
    DBL[("Database lib<br/>Prisma or TypeORM")]:::db
    QL[["Queue lib<br/>queue names + job DTOs"]]:::queue
    EVL["Events lib<br/>event types + publisher"]:::be
    STL[("Storage lib<br/>S3 client")]:::db
  end

  SEC --> SESS
  SEC --> INB
  SEC --> MSG
  SEC --> ATTA
  SEC --> RT
  INB --> SESS
  INB -->|"register address"| QL
  INB -->|"INBOX_DELETED"| EVL
  MSG --> DBL
  ATTA --> STL
  RT -->|"subscribe"| EVL
  INGM -->|"enqueue"| QL
  INGM --> STL
  QL --> PROC
  PROC --> ATTW
  PROC --> DBL
  PROC -->|"child job"| OTPM
  OTPM -->|"NEW_EMAIL"| EVL
  EXP --> DBL
  EXP --> ATTW
  EXP -->|"INBOX_EXPIRED"| EVL
  ATTW --> STL
  SESS --> DBL
  INB --> DBL

  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
  classDef mail fill:#FFF3E0,stroke:#E65100,color:#BF360C,stroke-width:2px
  classDef queue fill:#FFEBEE,stroke:#C62828,color:#B71C1C,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
```

### REST / SSE API Surface

| Method | Path | Module | Guards |
|---|---|---|---|
| POST | `/api/sessions` | Session | IP throttle |
| GET | `/api/sessions/me` | Session | Session |
| POST | `/api/inboxes` `{count}` | Inbox | Session, Throttle, Quota |
| GET | `/api/inboxes` | Inbox | Session |
| PATCH | `/api/inboxes/:id/extend` | Inbox | Session, Ownership |
| DELETE | `/api/inboxes/:id` | Inbox | Session, Ownership |
| GET | `/api/messages?view=unified&cursor=` | Message | Session |
| GET | `/api/messages?inboxId=&cursor=` | Message | Session, Ownership |
| GET | `/api/messages/:id` | Message | Session, Ownership |
| DELETE | `/api/messages/:id` | Message | Session, Ownership |
| GET | `/api/attachments/:id/download` | Attachment | Session, Ownership |
| GET | `/api/events` (SSE) | Real-time | Session |
| POST | `internal: /policy/recipient` (private network only) | Ingestion | mTLS / private bind |

---

## 7. Database Architecture (PostgreSQL)

```mermaid
erDiagram
  AnonymousSessions ||--o{ Inboxes : "owns"
  Domains ||--o{ Inboxes : "hosts"
  Inboxes ||--o{ Messages : "receives"
  Messages ||--o{ Attachments : "has"
  Messages ||--o{ EmailEvents : "logs"

  AnonymousSessions {
    uuid id PK
    string token_hash UK "HMAC-SHA256 of token"
    string ip_hash "HMAC of client IP, abuse only"
    int inbox_quota "default 10"
    string status "active / expired / revoked"
    timestamptz created_at
    timestamptz last_seen_at
    timestamptz expires_at "sliding 24h"
  }

  Domains {
    uuid id PK
    string name UK "yourdomain.com"
    bool is_active
    timestamptz created_at
  }

  Inboxes {
    uuid id PK
    uuid session_id FK
    uuid domain_id FK
    string local_part "12 chars, random"
    string address UK "local_part@domain"
    string status "active / expired / deleted"
    int message_count
    timestamptz created_at
    timestamptz expires_at "default now + 60 min"
    timestamptz deleted_at
  }

  Messages {
    uuid id PK
    uuid inbox_id FK
    string message_id_header
    string dedupe_hash "UNIQUE with inbox_id"
    string from_address
    string from_name
    string subject
    text text_body
    text html_sanitized
    string otp_code "nullable"
    bigint size_bytes
    string raw_object_key
    bool is_read
    timestamptz received_at
  }

  Attachments {
    uuid id PK
    uuid message_id FK
    string filename
    string content_type
    bigint size_bytes
    string storage_key
    string sha256
    bool is_blocked
  }

  EmailEvents {
    bigint id PK "monotonic, used as SSE event id"
    uuid message_id FK
    uuid inbox_id "denormalized for replay"
    string event_type "RECEIVED / OTP_EXTRACTED / DUPLICATE / FAILED"
    jsonb payload
    timestamptz created_at
  }
```

| Table | Key indexes / constraints |
|---|---|
| AnonymousSessions | `UNIQUE(token_hash)`, `INDEX(expires_at)` |
| Inboxes | `UNIQUE(address)`, `INDEX(session_id, status)`, `INDEX(expires_at) WHERE status = 'active'` |
| Messages | `UNIQUE(inbox_id, dedupe_hash)`, `INDEX(inbox_id, received_at DESC)` |
| Attachments | `INDEX(message_id)` |
| EmailEvents | `INDEX(inbox_id, id)` for Last-Event-ID replay |
| FKs | `ON DELETE CASCADE` from Sessions → Inboxes → Messages → Attachments / EmailEvents (object storage cleaned by job) |

---

## 8. Background Job Architecture (Redis + BullMQ)

```mermaid
flowchart LR
  subgraph TRIG["Incoming-email-triggered jobs"]
    ING["Email Ingestion Service"]:::mail
    Q1[["email-processing<br/>attempts 5 · exp backoff 2s"]]:::queue
    W1["Processing Worker<br/>concurrency 20"]:::queue
    Q2[["otp-extraction<br/>attempts 3 · child job"]]:::queue
    W2["OTP Worker"]:::queue
    PUB["PUBLISH NEW_EMAIL"]:::queue
  end

  subgraph SCHED["Scheduled jobs · BullMQ Job Schedulers"]
    CRON["Scheduler<br/>registered on worker boot"]:::queue
    J1[["inbox-expiration · every 1 min"]]:::queue
    J2[["session-expiration · every 15 min"]]:::queue
    J3[["message-cleanup · every 1 h"]]:::queue
    J4[["attachment-cleanup · daily 03:00"]]:::queue
    J5[["failed-job-retry · every 10 min"]]:::queue
  end

  A1["Mark inboxes expired where expires_at passed<br/>DEL Redis addr keys<br/>PUBLISH INBOX_EXPIRED"]:::be
  A2["Expire idle sessions<br/>cascade-delete their inboxes"]:::be
  A3["Hard-delete messages of expired or deleted inboxes<br/>older than retention window"]:::be
  A4["Delete orphaned objects<br/>att/, raw/, quarantine/ past TTL"]:::be
  A5["Re-queue retryable DLQ jobs<br/>e.g. after DB outage"]:::be

  subgraph FAIL["Failure handling"]
    F1{"Attempts<br/>exhausted?"}:::sec
    DLQ[["email-processing-dlq"]]:::err
    AL["Alertmanager<br/>DLQ size above 0"]:::infra
  end

  PG[("PostgreSQL")]:::db
  RD[("Redis")]:::queue
  S3[("Object storage")]:::db

  ING --> Q1 --> W1 --> Q2 --> W2 --> PUB --> RD
  W1 --> PG
  W1 --> S3
  W1 -->|"on failure"| F1
  F1 -->|"No"| Q1
  F1 -->|"Yes"| DLQ --> AL
  CRON --> J1 --> A1
  CRON --> J2 --> A2
  CRON --> J3 --> A3
  CRON --> J4 --> A4
  CRON --> J5 --> A5
  A5 --> DLQ
  A1 --> PG
  A1 --> RD
  A2 --> PG
  A3 --> PG
  A4 --> S3

  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
  classDef mail fill:#FFF3E0,stroke:#E65100,color:#BF360C,stroke-width:2px
  classDef queue fill:#FFEBEE,stroke:#C62828,color:#B71C1C,stroke-width:2px
  classDef infra fill:#ECEFF1,stroke:#455A64,color:#263238,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
  classDef err fill:#FFCDD2,stroke:#B71C1C,color:#B71C1C,stroke-width:2px
```

| Job | Trigger | Payload | Retry |
|---|---|---|---|
| email-processing | Ingestion enqueue | `inboxId, sessionId, rawObjectKey, parsedRef, dedupeHash` | 5, exponential |
| otp-extraction | Child of processing (BullMQ FlowProducer) | `messageId` | 3 |
| inbox-expiration | Every 1 min | — | Idempotent, next tick |
| session-expiration | Every 15 min | — | Idempotent |
| message-cleanup | Hourly | — | Idempotent, batched deletes |
| attachment-cleanup | Daily | — | Idempotent |
| failed-job-retry | Every 10 min | DLQ scan | Manual override possible |

**Redis keys:** `addr:ADDRESS` (hash: inboxId, sessionId, expiresAt) · `sess:TOKEN_HASH` (cache, 5 min) · `rl:*` (throttler counters) · `bull:*` (BullMQ) · Pub/Sub channel `events:session:SESSION_ID`.

---

## 9. Real-time Architecture (SSE)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant Q as TanStack Query
  participant N as Nginx
  participant G as NestJS Real-time Module
  participant R as Redis Pub/Sub
  participant W as Processing Worker
  participant X as Expiration Worker

  B->>N: new EventSource('/api/events'), cookie sent automatically
  N->>G: proxy with proxy_buffering off, read timeout 1h
  G->>G: SessionGuard resolves sessionId
  G->>G: register stream in map sessionId to set of connections
  G-->>B: 200 text/event-stream, retry 3000
  loop every 25 seconds
    G-->>B: keep-alive comment
  end

  W->>W: message saved and OTP extracted
  W->>R: PUBLISH events:session:S1 NEW_EMAIL (eventId, inboxId, messageId, from, subject, otp, receivedAt)
  R-->>G: delivered via PSUBSCRIBE events:session:*
  G-->>B: id eventId · event NEW_EMAIL · data JSON
  B->>Q: invalidateQueries messages-unified and messages-inbox-inboxId, bump unread in inboxes cache
  Q->>N: refetch only active queries, GET /api/messages
  N-->>Q: 200 messages
  Q-->>B: list re-renders, toast shown, no page refresh

  X->>R: PUBLISH events:session:S1 INBOX_EXPIRED (inboxId)
  R-->>G: event
  G-->>B: event INBOX_EXPIRED
  B->>Q: remove inbox from inboxes cache, removeQueries messages-inbox-inboxId

  Note over B,G: INBOX_DELETED follows the same path and syncs other open tabs
  Note over B,G: On reconnect the browser sends Last-Event-ID and G replays missed EmailEvents from PostgreSQL
```

| Event | Published by | Payload | Frontend reaction |
|---|---|---|---|
| `NEW_EMAIL` | Processing / OTP worker | `inboxId, messageId, from, subject, otp, receivedAt` | Invalidate unified + that inbox's list, unread badge +1, toast with OTP copy |
| `INBOX_EXPIRED` | Expiration worker | `inboxId` | Remove from sidebar, drop its message queries, switch to unified if selected |
| `INBOX_DELETED` | Inbox Module | `inboxId` | Same as above (cross-tab sync) |

---

## 10. Infrastructure and Deployment

```mermaid
flowchart TB
  SENDER["External mail servers"]:::mail
  BROWSER["User browser"]:::fe

  subgraph DNSZ["DNS · yourdomain.com"]
    MXR["MX 10 → mx.yourdomain.com"]:::infra
    AMX["A → Mail VPS IP<br/>mx.yourdomain.com + PTR"]:::infra
    AAPP["A / AAAA → App VPS IP<br/>yourdomain.com · www"]:::infra
  end

  subgraph MAILVPS["Mail Server VPS · Linux · Docker Compose"]
    subgraph MAILPUB["PUBLIC-FACING"]
      FW1["Firewall nftables / ufw<br/>allow 25 · 22 from admin IP only"]:::sec
      PF["Postfix + postscreen :25<br/>STARTTLS · Let's Encrypt cert"]:::mail
    end
    subgraph MAILPRIV["PRIVATE"]
      POL["Recipient policy service :10040"]:::mail
      INGS["Email Ingestion Service<br/>LMTP :2525 · mailparser"]:::mail
      AG1["node_exporter · promtail"]:::infra
    end
  end

  WG{{"WireGuard private tunnel<br/>Mail VPS to App VPS"}}:::sec

  subgraph APPVPS["Application VPS · Linux · Docker Compose"]
    subgraph APPPUB["PUBLIC-FACING"]
      FW2["Firewall<br/>allow 80 · 443 · 22 admin only"]:::sec
      NGX["Nginx reverse proxy<br/>TLS 1.3 · HSTS · Let's Encrypt<br/>rate limits · SSE unbuffered"]:::infra
    end
    subgraph APPPRIV["PRIVATE · docker network internal"]
      NEXT["Next.js :3000"]:::fe
      API["NestJS API :4000<br/>REST + SSE"]:::be
      WK[["NestJS BullMQ Workers<br/>scalable replicas"]]:::queue
      PG[("PostgreSQL 16 :5432")]:::db
      RD[("Redis 7 :6379<br/>AOF on · requirepass")]:::queue
      AG2["node_exporter · postgres_exporter<br/>redis_exporter · promtail"]:::infra
    end
  end

  OBJ[("Object Storage · S3 / MinIO<br/>raw/ · att/ · quarantine/<br/>private bucket, presigned only")]:::db

  subgraph OPS["Operations"]
    MON["Monitoring<br/>Prometheus · Grafana · Loki · Alertmanager"]:::infra
    BK["Database backups<br/>WAL-G continuous + nightly base backup<br/>offsite bucket, 14-day retention"]:::infra
  end

  SENDER -->|"MX lookup"| MXR --> AMX
  AMX -->|"SMTP :25"| FW1 --> PF
  PF -->|"policy check"| POL
  PF -->|"LMTP"| INGS
  POL --> WG
  INGS --> WG
  WG -->|"Redis lookups + enqueue"| RD
  INGS -->|"raw .eml"| OBJ

  BROWSER -->|"resolve"| AAPP
  AAPP -->|"HTTPS :443"| FW2 --> NGX
  NGX -->|"/"| NEXT
  NGX -->|"/api"| API
  API --> PG
  API --> RD
  WK --> PG
  WK --> RD
  WK --> OBJ
  API -->|"presigned URLs"| OBJ
  PG --> BK
  AG1 -.-> MON
  AG2 -.-> MON

  classDef fe fill:#E3F2FD,stroke:#1565C0,color:#0D47A1,stroke-width:2px
  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
  classDef mail fill:#FFF3E0,stroke:#E65100,color:#BF360C,stroke-width:2px
  classDef queue fill:#FFEBEE,stroke:#C62828,color:#B71C1C,stroke-width:2px
  classDef infra fill:#ECEFF1,stroke:#455A64,color:#263238,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
```

| Host | Port | Exposure | Service |
|---|---|---|---|
| Mail VPS | 25 | Public | Postfix SMTP |
| Mail VPS | 22 | Admin IP only | SSH (key auth) |
| Mail VPS | 2525, 10040 | Localhost / docker network | LMTP ingestion, policy service |
| App VPS | 80 → 443 | Public | Nginx (redirect + TLS) |
| App VPS | 3000, 4000 | Docker network only | Next.js, NestJS API |
| App VPS | 5432, 6379 | Docker network + WireGuard only | PostgreSQL, Redis |
| Both | 51820/udp | Peer IP only | WireGuard tunnel |

**DNS notes:** receive-only service needs `MX`, `A` for the MX host, and a `PTR` matching it. Publish `SPF -all` and a `DMARC p=reject` record so nobody can send *as* your domain.

---

## 11. Security Architecture

```mermaid
flowchart LR
  subgraph HTTPL["HTTP path · user traffic"]
    H1["Request"]:::fe --> H2{"Nginx<br/>IP rate limit + TLS"}:::sec
    H2 --> H3{"SessionGuard<br/>token hash valid,<br/>not expired?"}:::sec
    H3 --> H4{"ThrottlerGuard<br/>per session + IP"}:::sec
    H4 --> H5{"Quota check<br/>max 10 active inboxes"}:::sec
    H5 --> H6{"OwnershipGuard<br/>inbox.session_id match"}:::sec
    H6 --> H7["Handler"]:::be
    H7 --> H8["Response<br/>sanitized HTML · strict CSP<br/>sandboxed iframe"]:::sec
  end

  subgraph SMTPL["SMTP path · inbound mail"]
    S1["Connection"]:::mail --> S2{"postscreen<br/>RBL · pregreet · conn rate"}:::sec
    S2 --> S3{"Recipient validation<br/>at RCPT TO"}:::sec
    S3 --> S4{"Max size 10 MB"}:::sec
    S4 --> S5{"MIME limits<br/>depth · part count"}:::sec
    S5 --> S6{"Attachment allowlist<br/>type · size · count"}:::sec
    S6 --> S7["HTML sanitization<br/>before storage"]:::sec
    S7 --> S8[("Stored")]:::db
  end

  subgraph LIFE["Lifecycle and abuse"]
    L1["High-entropy addresses<br/>about 60 bits, crypto random"]:::sec
    L2["Session expiry<br/>24h sliding"]:::sec
    L3["Inbox expiry<br/>60 min, extendable"]:::sec
    L4["Message retention<br/>purged with inbox"]:::sec
    L5["Abuse prevention<br/>receive-only · no outbound SMTP<br/>session creation per IP"]:::sec
  end

  classDef fe fill:#E3F2FD,stroke:#1565C0,color:#0D47A1,stroke-width:2px
  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
  classDef mail fill:#FFF3E0,stroke:#E65100,color:#BF360C,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
```

| Control | Where enforced | Default |
|---|---|---|
| Session token validation | NestJS SessionGuard | 256-bit token, HMAC-SHA256 hash stored, HttpOnly + Secure + SameSite=Strict cookie |
| Inbox ownership verification | OwnershipGuard + query scoping | 404 on mismatch |
| High-entropy address generation | Inbox Module | 12 chars from 32-char alphabet via `crypto.randomInt`, reserved-word blocklist |
| Rate limiting | Nginx `limit_req` + NestJS Throttler (Redis store) | 60 req/min API, 5 sessions/hour/IP, 20 inbox creations/hour |
| Inbox creation quota | Inbox Module (row lock) | 10 active per session, 5 per bulk request |
| SMTP recipient validation | Postfix `check_policy_service` | Reject unknown/expired at RCPT with 550 |
| Max email size | Postfix `message_size_limit` + ingestion stream cap | 10 MB |
| HTML sanitization | Worker (sanitize-html) + iframe `sandbox` + CSP | No scripts, forms, iframes, event handlers; remote images blocked until user opts in |
| Attachment restrictions | Ingestion + Worker | Max 5 MB each, 10 per message; block exe, js, scr, bat, msi, vbs, macro Office types; served with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` |
| Session expiration | session-expiration job | 24h idle |
| Message retention | message-cleanup job | Deleted with inbox, hard cap 24h |
| Abuse prevention | Architecture | Receive-only (no outbound relay), SPF/DMARC reject, monitoring of session/inbox creation spikes, optional proof-of-work or CAPTCHA on session creation under load |
| Secrets | Docker secrets / env files | `SERVER_PEPPER`, DB and Redis passwords never in images |
| CSRF | SameSite=Strict + required custom header `X-Requested-With` on mutations | — |

---

## 12. Complete End-to-End System Flow

```mermaid
flowchart TB
  subgraph LANE1["Lane 1 · User creates addresses"]
    U1(("1 · USER")):::fe
    U2["2 · NEXT.JS FRONTEND"]:::fe
    U3["3 · ANONYMOUS SESSION<br/>HttpOnly token cookie"]:::sec
    U4["4 · NESTJS API<br/>Session · Inbox modules"]:::be
    U5["5 · GENERATE MULTIPLE<br/>EMAIL ADDRESSES"]:::be
    U6[("6 · POSTGRESQL<br/>Inboxes")]:::db
    U7[("7 · REDIS<br/>active address registry")]:::queue
  end

  subgraph LANE2["Lane 2 · Email arrives"]
    X1["8 · External Sender"]:::mail
    X2["9 · DNS MX"]:::infra
    X3["10 · POSTFIX SMTP<br/>recipient + size validation"]:::mail
    X4["11 · EMAIL PARSER<br/>Ingestion · mailparser"]:::mail
    X5[["12 · REDIS / BULLMQ<br/>email-processing"]]:::queue
    X6[["13 · EMAIL PROCESSING WORKER<br/>sanitize · attachments · OTP"]]:::queue
    X7[("14 · POSTGRESQL<br/>Messages · Attachments · EmailEvents")]:::db
    X8[("Object Storage")]:::db
  end

  subgraph LANE3["Lane 3 · Real-time delivery"]
    R1["15 · SSE REAL-TIME EVENTS<br/>NEW_EMAIL"]:::be
    R2["16 · NEXT.JS UNIFIED INBOX<br/>TanStack Query refetch"]:::fe
    R3(("17 · USER READS EMAIL")):::fe
  end

  U1 --> U2 --> U3 --> U4 --> U5 --> U6
  U5 --> U7
  X1 --> X2 --> X3 --> X4 --> X5 --> X6 --> X7
  X3 -.->|"lookup address"| U7
  X4 --> X8
  X6 --> X8
  U6 -.->|"inbox ownership"| X7
  X6 -->|"PUBLISH"| R1 --> R2 --> R3
  U2 -.->|"EventSource open"| R1

  classDef fe fill:#E3F2FD,stroke:#1565C0,color:#0D47A1,stroke-width:2px
  classDef be fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20,stroke-width:2px
  classDef db fill:#F3E5F5,stroke:#6A1B9A,color:#4A148C,stroke-width:2px
  classDef mail fill:#FFF3E0,stroke:#E65100,color:#BF360C,stroke-width:2px
  classDef queue fill:#FFEBEE,stroke:#C62828,color:#B71C1C,stroke-width:2px
  classDef infra fill:#ECEFF1,stroke:#455A64,color:#263238,stroke-width:2px
  classDef sec fill:#FFFDE7,stroke:#F9A825,color:#5D4037,stroke-width:2px
```

---

## Appendix A · Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Token storage | HttpOnly cookie, not localStorage | Immune to XSS token theft; `EventSource` sends cookies automatically (it cannot set headers) |
| Recipient rejection | At SMTP `RCPT TO`, not after accepting | Avoids generating bounces to forged senders (backscatter) and wasted processing |
| Postfix → app handoff | LMTP to a NestJS ingestion service | Clean status codes (250/451) map directly to success/temporary failure |
| Raw email first to object storage | Before parsing | Enables replay after parse or DB failures; keeps Redis job payloads small |
| Dedupe | BullMQ `jobId` + DB unique index | Two layers: in-flight duplicates and already-stored duplicates |
| Real-time transport | SSE over Redis Pub/Sub | One-way server push is all that is needed; works through Nginx; scales across API replicas |
| Mail and app on separate VPS | Yes | Port 25 reputation and attack surface isolated from the web app; joined by WireGuard |
| One NestJS monorepo, 3 apps | api, ingest, worker | Shared entities and DTOs, independent scaling and deployment |

## Appendix B · Default Configuration

| Setting | Value |
|---|---|
| Session TTL | 24h sliding |
| Inbox TTL | 60 min (extend up to 24h) |
| Max active inboxes per session | 10 |
| Max inboxes per bulk request | 5 |
| Max message size | 10 MB |
| Max attachment size / count | 5 MB / 10 |
| Processing job attempts | 5, exponential from 2s |
| SSE heartbeat | 25s |
| Unified inbox page size | 50, cursor on `(received_at, id)` |

---

## How to Convert This File into Images

Every diagram is a Mermaid block, so you can export all of them at once:

```bash
npm install -g @mermaid-js/mermaid-cli
mmdc -i temp-mail-system-design.md -o whiteboard.png -s 3 -b white
# produces whiteboard-1.png, whiteboard-2.png, ... one per diagram
```

Use `-o whiteboard.svg` for crisp vector output. For a single diagram, paste the block into **mermaid.live** and export PNG/SVG. GitHub, GitLab, Obsidian and Notion also render these blocks directly.
