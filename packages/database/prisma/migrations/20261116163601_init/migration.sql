-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('active', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "inbox_status" AS ENUM ('active', 'expired', 'deleted');

-- CreateEnum
CREATE TYPE "email_event_type" AS ENUM ('RECEIVED', 'OTP_EXTRACTED', 'DUPLICATE', 'FAILED');

-- CreateTable
CREATE TABLE "anonymous_sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_hash" TEXT,
    "inbox_quota" INTEGER NOT NULL DEFAULT 10,
    "status" "session_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "anonymous_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domains" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inboxes" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "local_part" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "inbox_status" NOT NULL DEFAULT 'active',
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "inbox_id" UUID NOT NULL,
    "message_id_header" TEXT,
    "dedupe_hash" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "from_name" TEXT,
    "subject" TEXT,
    "text_body" TEXT,
    "html_sanitized" TEXT,
    "otp_code" TEXT,
    "size_bytes" BIGINT NOT NULL,
    "raw_object_key" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "storage_key" TEXT,
    "sha256" TEXT,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" BIGSERIAL NOT NULL,
    "message_id" UUID,
    "inbox_id" UUID NOT NULL,
    "event_type" "email_event_type" NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anonymous_sessions_token_hash_key" ON "anonymous_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "anonymous_sessions_expires_at_idx" ON "anonymous_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "domains_name_key" ON "domains"("name");

-- CreateIndex
CREATE UNIQUE INDEX "inboxes_address_key" ON "inboxes"("address");

-- CreateIndex
CREATE INDEX "inboxes_session_id_status_idx" ON "inboxes"("session_id", "status");

-- CreateIndex
CREATE INDEX "inboxes_expires_at_idx" ON "inboxes"("expires_at");

-- CreateIndex
CREATE INDEX "messages_inbox_id_received_at_idx" ON "messages"("inbox_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "messages_inbox_id_dedupe_hash_key" ON "messages"("inbox_id", "dedupe_hash");

-- CreateIndex
CREATE INDEX "attachments_message_id_idx" ON "attachments"("message_id");

-- CreateIndex
CREATE INDEX "email_events_inbox_id_id_idx" ON "email_events"("inbox_id", "id");

-- AddForeignKey
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "anonymous_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
