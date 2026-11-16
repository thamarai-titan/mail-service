"use client";

import { useState } from "react";
import { useCopy } from "../hooks/use-copy";
import { useDeleteMessage, useMessage } from "../hooks/use-messages";
import { ApiError } from "../lib/api";
import { formatBytes, formatFullDate } from "../lib/format";
import type { MessageDetail } from "../lib/types";
import styles from "./email-viewer.module.css";
import {
  BackIcon,
  CheckIcon,
  CopyIcon,
  PaperclipIcon,
  TrashIcon,
} from "./icons";

const REMOTE_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']?\s*(https?:)?\/\//i;

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
}

export function EmailViewer({ messageId, onClose }: Props) {
  const query = useMessage(messageId);

  return (
    <section
      className={styles.viewer}
      data-open={messageId !== null}
      aria-label="Email"
    >
      {messageId === null ? (
        <p className={styles.placeholder}>Select a message to read it.</p>
      ) : query.error ? (
        <div className={styles.placeholder} role="alert">
          <p>
            {query.error instanceof ApiError && query.error.status === 404
              ? "This message is no longer available."
              : `Could not load this message. ${query.error.message}`}
          </p>
          <p>
            <button
              className={styles.secondary}
              style={{ marginTop: 12 }}
              onClick={onClose}
            >
              Back to messages
            </button>
          </p>
        </div>
      ) : !query.data ? (
        <p className={styles.placeholder}>Loading…</p>
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
  const { copied, copy } = useCopy();
  const remove = useDeleteMessage();
  const [showImages, setShowImages] = useState(false);
  const html = message.htmlSanitized;
  const hasRemoteImages = html !== null && REMOTE_IMAGE.test(html);

  return (
    <>
      <header className={styles.header}>
        <div className={styles.toolbar}>
          <button
            className={`iconButton ${styles.back}`}
            aria-label="Back to messages"
            onClick={onClose}
          >
            <BackIcon />
          </button>
          <h2
            className={styles.subject}
            data-missing={message.subject === null}
          >
            {message.subject ?? "(no subject)"}
          </h2>
          <button
            className="iconButton"
            title="Delete message"
            aria-label="Delete message"
            disabled={remove.isPending}
            onClick={() => remove.mutate(message.id, { onSuccess: onClose })}
          >
            <TrashIcon />
          </button>
        </div>

        <dl className={styles.details}>
          <dt>From</dt>
          <dd>
            {message.fromName ? `${message.fromName} ` : ""}
            <span className={styles.mono}>
              {message.fromName
                ? `<${message.fromAddress}>`
                : message.fromAddress}
            </span>
          </dd>
          <dt>To</dt>
          <dd className={styles.mono}>{message.inboxAddress}</dd>
          <dt>Date</dt>
          <dd>{formatFullDate(message.receivedAt)}</dd>
        </dl>

        {(message.otpCode !== null ||
          (hasRemoteImages && !showImages) ||
          remove.error) && (
          <div className={styles.actions}>
            {message.otpCode !== null && (
              <button
                className={styles.otp}
                onClick={() => void copy(message.otpCode ?? "")}
              >
                <span className={styles.otpCode}>{message.otpCode}</span>
                {copied ? "Copied" : "Copy code"}
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            )}
            {hasRemoteImages && !showImages && (
              <button
                className={styles.secondary}
                onClick={() => setShowImages(true)}
              >
                Show images
              </button>
            )}
            {remove.error && (
              <span role="alert">Could not delete. {remove.error.message}</span>
            )}
          </div>
        )}
      </header>

      <div className={styles.body}>
        {html !== null ? (
          <iframe
            className={styles.frame}
            title="Email content"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={buildEmailDocument(html, showImages)}
          />
        ) : (
          <pre className={styles.text}>
            {message.textBody ?? "This message has no content."}
          </pre>
        )}
      </div>

      {message.attachments.length > 0 && (
        <footer className={styles.attachments}>
          <h3 className={styles.attachmentsTitle}>
            {message.attachments.length === 1
              ? "1 attachment"
              : `${message.attachments.length} attachments`}
          </h3>
          <ul className={styles.attachmentList}>
            {message.attachments.map((attachment) => (
              <li
                key={attachment.id}
                className={styles.attachment}
                data-blocked={attachment.isBlocked}
              >
                <PaperclipIcon />
                <span
                  className={styles.attachmentName}
                  title={attachment.filename}
                >
                  {attachment.filename}
                </span>
                <span className={styles.attachmentNote}>
                  {attachment.isBlocked
                    ? "Blocked for safety"
                    : formatBytes(attachment.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </>
  );
}
