"use client";

import { useState } from "react";
import { useCopy } from "../hooks/use-copy";
import {
  MAX_ACTIVE_INBOXES,
  MAX_PER_REQUEST,
  useCreateInboxes,
  useDeleteInbox,
  useExtendInbox,
} from "../hooks/use-inboxes";
import { useNow } from "../hooks/use-now";
import { formatCountdown } from "../lib/format";
import type { Inbox, InboxView } from "../lib/types";
import {
  CheckIcon,
  ClockPlusIcon,
  CopyIcon,
  InboxIcon,
  TrashIcon,
} from "./icons";
import styles from "./inbox-sidebar.module.css";

const LOW_TIME_MS = 5 * 60 * 1000;

interface Props {
  inboxes: Inbox[];
  isLoading: boolean;
  error: Error | null;
  view: InboxView;
  onSelectView: (view: InboxView) => void;
}

export function InboxSidebar({
  inboxes,
  isLoading,
  error,
  view,
  onSelectView,
}: Props) {
  const now = useNow();
  const create = useCreateInboxes();
  const [requestedCount, setRequestedCount] = useState(1);

  // The server is the authority on expiry; this only stops a dead address lingering between polls.
  const live = inboxes.filter((inbox) => Date.parse(inbox.expiresAt) > now);
  const remaining = MAX_ACTIVE_INBOXES - live.length;
  const maxCount = Math.min(MAX_PER_REQUEST, remaining);
  const count = Math.min(requestedCount, Math.max(maxCount, 1));
  const totalUnread = live.reduce((sum, inbox) => sum + inbox.unreadCount, 0);

  const generate = () => {
    create.mutate(count, {
      onSuccess: (created) => {
        const newest = created[0];
        if (newest) onSelectView(newest.id);
      },
    });
  };

  return (
    <aside className={styles.sidebar}>
      <h1 className={styles.brand}>Temp Mail</h1>
      <p className={styles.tagline}>Disposable addresses, one inbox.</p>

      <div className={styles.generate}>
        <select
          className={styles.count}
          aria-label="How many addresses to generate"
          value={count}
          disabled={maxCount < 1}
          onChange={(event) => setRequestedCount(Number(event.target.value))}
        >
          {Array.from(
            { length: Math.max(maxCount, 1) },
            (_, index) => index + 1,
          ).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          className={styles.generateButton}
          onClick={generate}
          disabled={isLoading || create.isPending || maxCount < 1}
        >
          {create.isPending
            ? "Generating…"
            : count > 1
              ? "Generate addresses"
              : "Generate address"}
        </button>
      </div>

      {create.error ? (
        <p className={styles.notice} data-tone="error" role="alert">
          {create.error.message}
        </p>
      ) : maxCount < 1 ? (
        <p className={styles.notice}>
          You have {MAX_ACTIVE_INBOXES} active addresses. Delete one to generate
          another.
        </p>
      ) : null}

      <ul className={styles.list}>
        <li className={styles.item} data-selected={view === "unified"}>
          <button
            className={styles.select}
            onClick={() => onSelectView("unified")}
          >
            <span className={`${styles.selectText} ${styles.unifiedLabel}`}>
              <InboxIcon />
              All inboxes
            </span>
            {totalUnread > 0 && (
              <span className="badge" aria-label={`${totalUnread} unread`}>
                {totalUnread}
              </span>
            )}
          </button>
        </li>

        <li className={styles.divider} aria-hidden="true">
          Addresses · {live.length}/{MAX_ACTIVE_INBOXES}
        </li>

        {error ? (
          <li className={styles.empty} role="alert">
            Could not load your addresses. {error.message}
          </li>
        ) : isLoading ? (
          <li className={styles.empty}>Loading…</li>
        ) : live.length === 0 ? (
          <li className={styles.empty}>
            No addresses yet. Generate one and use it anywhere you need to
            receive an email.
          </li>
        ) : (
          live.map((inbox) => (
            <InboxItem
              key={inbox.id}
              inbox={inbox}
              now={now}
              selected={view === inbox.id}
              onSelect={() => onSelectView(inbox.id)}
            />
          ))
        )}
      </ul>
    </aside>
  );
}

interface ItemProps {
  inbox: Inbox;
  now: number;
  selected: boolean;
  onSelect: () => void;
}

function InboxItem({ inbox, now, selected, onSelect }: ItemProps) {
  const { copied, copy } = useCopy();
  const extend = useExtendInbox();
  const remove = useDeleteInbox();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const remainingMs = Date.parse(inbox.expiresAt) - now;

  return (
    <li className={styles.item} data-selected={selected}>
      <button className={styles.select} onClick={onSelect}>
        <span className={styles.selectText}>
          <span className={styles.address} title={inbox.address}>
            {inbox.address}
          </span>
          <span
            className={styles.countdown}
            data-low={remainingMs < LOW_TIME_MS}
          >
            Expires in {formatCountdown(remainingMs)}
          </span>
        </span>
        {inbox.unreadCount > 0 && (
          <span className="badge" aria-label={`${inbox.unreadCount} unread`}>
            {inbox.unreadCount}
          </span>
        )}
      </button>

      <button
        className="iconButton"
        data-tone={copied ? "success" : undefined}
        title={copied ? "Copied" : "Copy address"}
        aria-label={copied ? "Copied" : `Copy ${inbox.address}`}
        onClick={() => void copy(inbox.address)}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <button
        className="iconButton"
        title="Add one hour"
        aria-label={`Add one hour to ${inbox.address}`}
        disabled={extend.isPending}
        onClick={() => extend.mutate(inbox.id)}
      >
        <ClockPlusIcon />
      </button>
      <button
        className="iconButton"
        data-tone={confirmingDelete ? "danger" : undefined}
        title={
          confirmingDelete
            ? "Click again to delete this address and its mail"
            : "Delete address"
        }
        aria-label={
          confirmingDelete
            ? `Confirm deleting ${inbox.address} and its mail`
            : `Delete ${inbox.address}`
        }
        disabled={remove.isPending}
        onBlur={() => setConfirmingDelete(false)}
        onClick={() => {
          if (confirmingDelete) remove.mutate(inbox.id);
          else setConfirmingDelete(true);
        }}
      >
        <TrashIcon />
      </button>
    </li>
  );
}
