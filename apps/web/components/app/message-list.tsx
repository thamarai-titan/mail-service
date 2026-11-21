"use client";

import { PaperclipIcon, SendIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMessages } from "@/hooks/use-messages";
import { formatReceivedAt } from "@/lib/format";
import type { InboxView, MessageSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { SenderAvatar } from "./sender-avatar";

interface Props {
  view: InboxView;
  /** In the unified view with several addresses, each row says which one received it. */
  showInboxAddress: boolean;
  /** Shown in the empty state: where to send a test message. */
  waitingAddress: string | null;
  selectedMessageId: string | null;
  onSelectMessage: (id: string) => void;
  /** The list has the whole width (nothing open): one line per message on larger screens. */
  wide: boolean;
  className?: string;
}

export function MessageList({
  view,
  showInboxAddress,
  waitingAddress,
  selectedMessageId,
  onSelectMessage,
  wide,
  className,
}: Props) {
  const query = useMessages(view);
  const oneLine = useMediaQuery("(min-width: 768px)") && wide;
  const messages = query.data?.pages.flatMap((page) => page.messages) ?? [];

  return (
    <section
      aria-label="Messages"
      className={cn("flex min-h-0 flex-col", className)}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.error ? (
          <div role="alert" className="p-8 text-center text-sm">
            <p className="font-medium">Could not load messages</p>
            <p className="mt-1 text-muted-foreground">{query.error.message}</p>
          </div>
        ) : query.isPending ? (
          <MessageSkeletons />
        ) : messages.length === 0 ? (
          <WaitingForMail address={waitingAddress} />
        ) : (
          // Keyed by view so switching lists does not replay the entry animation.
          <ul key={view} className="divide-y">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <MessageRow
                  key={message.id}
                  oneLine={oneLine}
                  message={message}
                  showInboxAddress={showInboxAddress}
                  selected={message.id === selectedMessageId}
                  onSelect={() => onSelectMessage(message.id)}
                />
              ))}
            </AnimatePresence>
            {query.hasNextPage && (
              <li className="p-3">
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage
                    ? "Loading…"
                    : "Load older messages"}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

function MessageRow({
  message,
  oneLine,
  showInboxAddress,
  selected,
  onSelect,
}: {
  message: MessageSummary;
  oneLine: boolean;
  showInboxAddress: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const hasOtp = message.otpCode !== null;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className="relative"
    >
      {/* A brief glow marks mail that arrived while the page was open. */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-primary/10"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 1.8, delay: 0.4 }}
      />
      {oneLine ? (
        <button
          type="button"
          onClick={onSelect}
          className="relative flex w-full items-center gap-5 px-6 py-4 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60"
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              message.isRead ? "bg-transparent" : "bg-primary",
            )}
            aria-label={message.isRead ? undefined : "Unread"}
          />
          <SenderAvatar
            name={message.fromName}
            address={message.fromAddress}
            className="size-8 text-[11px]"
          />
          <span
            className={cn(
              "w-44 shrink-0 truncate text-sm",
              message.isRead ? "text-foreground/80" : "font-semibold",
            )}
          >
            {message.fromName ?? message.fromAddress}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">
            <span
              className={cn(
                message.subject === null && "text-muted-foreground italic",
                !message.isRead && message.subject !== null && "font-medium",
              )}
            >
              {message.subject ?? "(no subject)"}
            </span>
            <span className="text-muted-foreground"> — {message.preview}</span>
          </span>
          {showInboxAddress && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {message.inboxAddress.split("@")[0]}
            </span>
          )}
          {message.attachmentCount > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <PaperclipIcon className="size-3.5" />
              {message.attachmentCount}
            </span>
          )}
          {/* Room for the code button, which sits over the row (it cannot nest in it). */}
          {hasOtp && <span className="w-[104px] shrink-0" />}
          <time
            dateTime={message.receivedAt}
            className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
          >
            {formatReceivedAt(message.receivedAt)}
          </time>
        </button>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className={cn(
            "relative flex w-full gap-3.5 px-5 py-4 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60",
            selected && "bg-accent hover:bg-accent",
          )}
        >
          {selected && (
            <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-primary" />
          )}
          <SenderAvatar name={message.fromName} address={message.fromAddress} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  message.isRead ? "text-foreground/80" : "font-semibold",
                )}
              >
                {message.fromName ?? message.fromAddress}
              </span>
              {!message.isRead && (
                <span
                  className="size-2 shrink-0 self-center rounded-full bg-primary"
                  aria-label="Unread"
                />
              )}
              <time
                dateTime={message.receivedAt}
                className="shrink-0 text-xs text-muted-foreground tabular-nums"
              >
                {formatReceivedAt(message.receivedAt)}
              </time>
            </span>
            <span
              className={cn(
                "truncate text-sm",
                message.subject === null && "text-muted-foreground italic",
                !message.isRead && message.subject !== null && "font-medium",
              )}
            >
              {message.subject ?? "(no subject)"}
            </span>
            <span className="line-clamp-1 text-[13px] text-muted-foreground">
              {message.preview}
            </span>
            {(showInboxAddress || message.attachmentCount > 0 || hasOtp) && (
              <span
                className={cn(
                  "mt-1.5 flex min-h-7 items-center gap-2 text-xs text-muted-foreground",
                  hasOtp && "pr-32",
                )}
              >
                {showInboxAddress && (
                  <span className="min-w-0 truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                    {message.inboxAddress}
                  </span>
                )}
                {message.attachmentCount > 0 && (
                  <span className="flex shrink-0 items-center gap-1">
                    <PaperclipIcon className="size-3.5" />
                    {message.attachmentCount}
                  </span>
                )}
              </span>
            )}
          </span>
        </button>
      )}
      {hasOtp && (
        <CopyButton
          value={message.otpCode!}
          label={`Copy code ${message.otpCode}`}
          variant="outline"
          size="sm"
          // Inverted, monospace and spaced out: the strongest thing in the row.
          className={cn(
            "absolute h-7 gap-1.5 border-code-border bg-code px-2.5 font-mono text-[13px] font-semibold tracking-[0.12em] text-code-foreground shadow-sm hover:bg-code/85 hover:text-code-foreground active:scale-95 dark:bg-code dark:hover:bg-code/85",
            oneLine
              ? "top-1/2 right-[5.75rem] -translate-y-1/2"
              : "right-5 bottom-4",
          )}
        >
          {message.otpCode}
        </CopyButton>
      )}
    </motion.li>
  );
}

function MessageSkeletons() {
  return (
    <ul aria-label="Loading messages" className="divide-y">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="flex gap-3 px-4 py-4">
          <Skeleton className="size-9 rounded-full" />
          <span className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Centred in the inbox: a paper plane on a moving dotted trail, and one line on what to do. */
function WaitingForMail({ address }: { address: string | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 py-12 text-center">
      <svg
        viewBox="0 0 112 44"
        className="h-14 w-36 shrink-0 text-muted-foreground"
        aria-hidden="true"
      >
        <path
          d="M4 38 C 30 40, 40 10, 62 18 S 88 30, 96 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="2 6"
          className="animate-dash"
        />
        <foreignObject x="88" y="0" width="24" height="24">
          <SendIcon className="size-5 -rotate-12 text-primary" />
        </foreignObject>
      </svg>
      <div className="max-w-md min-w-0">
        <p className="text-lg font-medium">
          Waiting for mail
          <span className="inline-flex w-5">
            <span className="animate-pulse">.</span>
            <span className="animate-pulse [animation-delay:200ms]">.</span>
            <span className="animate-pulse [animation-delay:400ms]">.</span>
          </span>
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {address ? (
            <>
              Send anything to{" "}
              <span className="font-mono break-all text-foreground">
                {address}
              </span>
              . It lands here within a second.
            </>
          ) : (
            "Make an address to start receiving email."
          )}
        </p>
      </div>
    </div>
  );
}
