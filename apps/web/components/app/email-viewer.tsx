"use client";

import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  DownloadIcon,
  FileIcon,
  ImageOffIcon,
  KeyRoundIcon,
  LinkIcon,
  MailOpenIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDeleteMessage, useMessage } from "@/hooks/use-messages";
import { ApiError } from "@/lib/api";
import { formatBytes, formatFullDate } from "@/lib/format";
import type { MessageDetail } from "@/lib/types";
import { solidButton } from "@/lib/styles";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { SenderAvatar } from "./sender-avatar";

const REMOTE_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']?\s*(https?:)?\/\//i;

/** Words that mark the one link a sign-up email wants you to click. */
const ACTION_TEXT =
  /verif|confirm|activat|validat|sign[\s-]?in|log[\s-]?in|magic link|reset|get started|accept|join/i;
const ACTION_HREF = /verif|confirm|activat|token|magic|auth|login|signin/i;
const NOT_ACTION =
  /unsubscribe|preferences|privacy|terms|view (it )?in (your )?browser|help|support/i;

/**
 * The verification link in a message, if it has one: the link whose text or address looks
 * like "confirm your email". Plenty of sign-ups send a link instead of a code.
 */
function findActionLink(html: string): { href: string; host: string } | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let best: { href: string; host: string; score: number } | null = null;
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) continue;
    const text = anchor.textContent?.trim() ?? "";
    if (NOT_ACTION.test(text) || NOT_ACTION.test(href)) continue;
    let score = 0;
    if (ACTION_TEXT.test(text)) score += 3;
    if (ACTION_HREF.test(href)) score += 2;
    // Call-to-action links are usually styled as buttons.
    if (/background|padding/i.test(anchor.getAttribute("style") ?? ""))
      score += 1;
    if (score >= 3 && (!best || score > best.score)) {
      try {
        best = { href, host: new URL(href).host, score };
      } catch {
        // Not a parsable URL: skip it.
      }
    }
  }
  return best && { href: best.href, host: best.host };
}

/**
 * Wraps the already-sanitized email HTML in its own document. The frame it is shown in is
 * sandboxed, and this policy blocks scripts, forms, fonts and network requests; images load
 * from the network only after the reader opts in, since they reveal that the mail was opened.
 */
function buildEmailDocument(html: string, allowRemoteImages: boolean): string {
  const images = allowRemoteImages
    ? "img-src data: https: http:"
    : "img-src data:";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; ${images}">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>
  body { margin: 20px; font: 15px/1.55 system-ui, sans-serif; color: #1b1b19; background: #fff; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
</style>
</head>
<body>${html}</body>
</html>`;
}

interface Props {
  messageId: string | null;
  onClose: () => void;
  className?: string;
}

export function EmailViewer({ messageId, onClose, className }: Props) {
  const query = useMessage(messageId);

  return (
    <section
      aria-label="Email"
      className={cn("flex min-h-0 flex-col bg-background/40", className)}
    >
      {messageId === null ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl border bg-card">
            <MailOpenIcon className="size-7 text-muted-foreground" />
          </span>
          <p className="mt-4 font-medium">Pick a message to read it</p>
        </div>
      ) : query.error ? (
        <div
          role="alert"
          className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm"
        >
          <p>
            {query.error instanceof ApiError && query.error.status === 404
              ? "This message is no longer available."
              : `Could not load this message. ${query.error.message}`}
          </p>
          <Button variant="outline" onClick={onClose}>
            Back to messages
          </Button>
        </div>
      ) : !query.data ? (
        <ViewerSkeleton />
      ) : (
        // Keyed so per-message choices such as "show images" reset for the next message.
        <Message key={query.data.id} message={query.data} onClose={onClose} />
      )}
    </section>
  );
}

function Message({
  message,
  onClose,
}: {
  message: MessageDetail;
  onClose: () => void;
}) {
  const remove = useDeleteMessage();
  const [showImages, setShowImages] = useState(false);
  const html = message.htmlSanitized;
  const hasRemoteImages = html !== null && REMOTE_IMAGE.test(html);
  const actionLink = useMemo(
    () => (html !== null ? findActionLink(html) : null),
    [html],
  );

  const deleteMessage = () =>
    remove.mutate(message.id, {
      onSuccess: () => {
        toast.success("Message deleted");
        onClose();
      },
      onError: (error) => toast.error(`Could not delete: ${error.message}`),
    });

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="shrink-0 border-b bg-card px-4 pt-3 pb-4 sm:px-6">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 md:hidden"
            aria-label="Back to messages"
            onClick={onClose}
          >
            <ArrowLeftIcon />
          </Button>
          <h2
            className={cn(
              "min-w-0 flex-1 pt-1 text-lg leading-snug font-semibold text-balance sm:text-xl",
              message.subject === null && "text-muted-foreground italic",
            )}
          >
            {message.subject ?? "(no subject)"}
          </h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete message"
                disabled={remove.isPending}
                onClick={deleteMessage}
              >
                <Trash2Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete message</TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <SenderAvatar
            name={message.fromName}
            address={message.fromAddress}
            className="size-10"
          />
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate">
              <span className="font-medium">
                {message.fromName ?? message.fromAddress}
              </span>
              {message.fromName && (
                <span className="text-muted-foreground">
                  {" "}
                  &lt;{message.fromAddress}&gt;
                </span>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              to <span className="font-mono">{message.inboxAddress}</span> ·{" "}
              {formatFullDate(message.receivedAt)}
            </p>
          </div>
        </div>

        {message.otpCode !== null && (
          <div className="mt-4 rounded-[18px] border bg-frame p-1.5">
            <p className="flex items-center gap-1.5 px-2 pt-0.5 pb-1.5 font-mono text-xs text-muted-foreground">
              <KeyRoundIcon className="size-3.5" />
              verification code
            </p>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
              <p className="sr-only">Code {message.otpCode}</p>
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {/* Each character in its own cell, like the box the code is typed into. */}
                {[...message.otpCode].map((char, index) =>
                  char === " " || char === "-" ? (
                    <span key={index} className="w-2 text-muted-foreground">
                      –
                    </span>
                  ) : (
                    <motion.span
                      key={index}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: 0.05 * index,
                        type: "spring",
                        stiffness: 420,
                        damping: 28,
                      }}
                      className="flex h-12 w-9 items-center justify-center rounded-lg border bg-background font-mono text-2xl font-semibold sm:w-10"
                    >
                      {char}
                    </motion.span>
                  ),
                )}
              </div>
              <CopyButton
                value={message.otpCode}
                label={`Copy code ${message.otpCode}`}
                className={cn("ml-auto h-11 px-4", solidButton)}
              >
                {(copied) => (copied ? "Copied" : "Copy code")}
              </CopyButton>
            </div>
          </div>
        )}

        {actionLink && (
          <div className="mt-3 rounded-[18px] border bg-frame p-1.5">
            <p className="flex items-center gap-1.5 px-2 pt-0.5 pb-1.5 font-mono text-xs text-muted-foreground">
              <LinkIcon className="size-3.5" />
              verification link
            </p>
            <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
              <p className="min-w-0 flex-1 text-sm">
                <span className="block text-muted-foreground">Opens</span>
                <span className="block truncate font-mono font-medium">
                  {actionLink.host}
                </span>
              </p>
              <Button asChild className={cn("h-10 px-4", solidButton)}>
                <a
                  href={actionLink.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open link
                  <ArrowUpRightIcon />
                </a>
              </Button>
            </div>
          </div>
        )}

        {hasRemoteImages && !showImages && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <ImageOffIcon className="size-4 shrink-0" />
            <span className="flex-1">
              Remote images are hidden so the sender cannot tell you opened
              this.
            </span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => setShowImages(true)}
            >
              Show images
            </Button>
          </div>
        )}
      </header>

      <div className="flex min-h-[60dvh] flex-1 flex-col p-3 sm:p-4 md:min-h-0">
        {html !== null ? (
          <iframe
            className="min-h-[60dvh] w-full flex-1 rounded-xl border bg-white shadow-sm md:min-h-0"
            title="Email content"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={buildEmailDocument(html, showImages)}
          />
        ) : (
          <pre className="flex-1 overflow-auto rounded-xl border bg-card p-5 font-sans text-[15px] leading-relaxed whitespace-pre-wrap">
            {message.textBody ?? "This message has no content."}
          </pre>
        )}
      </div>

      {message.attachments.length > 0 && (
        <footer className="shrink-0 border-t bg-card px-4 py-3 sm:px-6">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {message.attachments.length === 1
              ? "1 attachment"
              : `${message.attachments.length} attachments`}
          </h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {message.attachments.map((attachment) =>
              attachment.isBlocked ? (
                <li
                  key={attachment.id}
                  className="flex items-center gap-3 rounded-xl border border-dashed p-2.5"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                    <ShieldAlertIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm line-through decoration-muted-foreground/60">
                      {attachment.filename}
                    </span>
                    <span className="text-xs text-destructive">
                      Blocked for safety
                    </span>
                  </span>
                </li>
              ) : (
                <li key={attachment.id}>
                  <a
                    href={`/api/attachments/${attachment.id}/download`}
                    download={attachment.filename}
                    className="group flex items-center gap-3 rounded-xl border p-2.5 transition-all outline-none hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <FileIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {attachment.filename}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(attachment.sizeBytes)}
                      </span>
                    </span>
                    <DownloadIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-y-0.5 group-hover:text-primary" />
                  </a>
                </li>
              ),
            )}
          </ul>
        </footer>
      )}
    </motion.div>
  );
}

function ViewerSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-6 w-3/5" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
