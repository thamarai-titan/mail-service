"use client";

import { useCopy } from "../hooks/use-copy";
import { useMessages } from "../hooks/use-messages";
import { formatReceivedAt } from "../lib/format";
import type { InboxView, MessageSummary } from "../lib/types";
import { CheckIcon, CopyIcon, PaperclipIcon } from "./icons";
import styles from "./message-list.module.css";

interface Props {
  view: InboxView;
  title: string;
  /** In the unified view each row says which address received it. */
  showInboxAddress: boolean;
  hasInboxes: boolean;
  selectedMessageId: string | null;
  onSelectMessage: (id: string) => void;
}

export function MessageList({
  view,
  title,
  showInboxAddress,
  hasInboxes,
  selectedMessageId,
  onSelectMessage,
}: Props) {
  const query = useMessages(view);
  const messages = query.data?.pages.flatMap((page) => page.messages) ?? [];

  return (
    <section className={styles.pane} aria-label="Messages">
      <header className={styles.header}>
        <h2
          className={styles.title}
          data-mono={view !== "unified"}
          title={title}
        >
          {title}
        </h2>
      </header>

      {query.error ? (
        <div className={styles.state} role="alert">
          <p className={styles.stateTitle}>Could not load messages</p>
          <p>{query.error.message}</p>
        </div>
      ) : query.isPending ? (
        <div className={styles.state}>Loading…</div>
      ) : messages.length === 0 ? (
        <div className={styles.state}>
          <p className={styles.stateTitle}>
            {hasInboxes ? "Waiting for mail" : "No mail yet"}
          </p>
          <p>
            {hasInboxes
              ? "Anything sent to your addresses shows up here within a few seconds."
              : "Generate an address to start receiving email."}
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              showInboxAddress={showInboxAddress}
              selected={message.id === selectedMessageId}
              onSelect={() => onSelectMessage(message.id)}
            />
          ))}
          {query.hasNextPage && (
            <li>
              <button
                className={styles.more}
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? "Loading…" : "Load older messages"}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

interface RowProps {
  message: MessageSummary;
  showInboxAddress: boolean;
  selected: boolean;
  onSelect: () => void;
}

function MessageRow({
  message,
  showInboxAddress,
  selected,
  onSelect,
}: RowProps) {
  const { copied, copy } = useCopy();
  const showMeta =
    showInboxAddress || message.attachmentCount > 0 || message.otpCode !== null;

  return (
    <li
      className={styles.row}
      data-selected={selected}
      data-unread={!message.isRead}
      data-has-otp={message.otpCode !== null}
    >
      <button className={styles.rowButton} onClick={onSelect}>
        <span className={styles.top}>
          <span className={styles.from}>
            {message.fromName ?? message.fromAddress}
          </span>
          <time className={styles.time} dateTime={message.receivedAt}>
            {formatReceivedAt(message.receivedAt)}
          </time>
        </span>
        <span
          className={styles.subject}
          data-missing={message.subject === null}
        >
          {message.subject ?? "(no subject)"}
        </span>
        <span className={styles.preview}>{message.preview}</span>
        {showMeta && (
          <span className={styles.meta}>
            {showInboxAddress && (
              <span className={styles.chip}>{message.inboxAddress}</span>
            )}
            {message.attachmentCount > 0 && (
              <span className={styles.attachments}>
                <PaperclipIcon />
                {message.attachmentCount}
              </span>
            )}
          </span>
        )}
      </button>
      {message.otpCode !== null && (
        <button
          className={styles.otp}
          title={copied ? "Copied" : "Copy code"}
          aria-label={copied ? "Code copied" : `Copy code ${message.otpCode}`}
          onClick={() => void copy(message.otpCode ?? "")}
        >
          {message.otpCode}
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      )}
    </li>
  );
}
