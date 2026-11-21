import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { setLiveStatus } from "../lib/live-status";
import type { Inbox, MessagePage, MessageSummary } from "../lib/types";
import { INBOXES_KEY } from "./use-inboxes";

const MAX_RETRY_DELAY_MS = 30_000;

interface SessionEvent {
  type: "NEW_EMAIL" | "INBOX_EXPIRED" | "INBOX_DELETED";
  inboxId: string;
  messageId?: string;
}

function parse(event: Event): SessionEvent | null {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as SessionEvent;
  } catch {
    return null;
  }
}

/** What arrived: the message summary when a loaded list already holds it, else just the inbox. */
export interface NewMail {
  inboxId: string;
  messageId: string | undefined;
  summary: MessageSummary | undefined;
}

/**
 * Subscribes to the session's server-sent events and keeps the cached lists in step: new mail
 * refetches the affected lists, a deleted or expired inbox is dropped. Call once, after the
 * session exists. The browser reconnects by itself after a dropped connection; when the server
 * refuses the stream (an expired session, too many tabs) this retries with backoff instead.
 */
export function useLiveUpdates(
  enabled: boolean,
  onNewMail?: (mail: NewMail) => void,
): void {
  const queryClient = useQueryClient();
  const onNewMailRef = useRef(onNewMail);
  useEffect(() => {
    onNewMailRef.current = onNewMail;
  });

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let openedBefore = false;
    let stopped = false;

    const onNewEmail = (event: Event) => {
      const data = parse(event);
      if (!data) return;
      // Only the lists on screen refetch; whichever of them holds the new message names it.
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", "unified"] }),
        queryClient.invalidateQueries({
          queryKey: ["messages", data.inboxId],
        }),
        queryClient.invalidateQueries({ queryKey: INBOXES_KEY }),
      ]).then(() => {
        const summary = queryClient
          .getQueriesData<InfiniteData<MessagePage>>({ queryKey: ["messages"] })
          .flatMap(([, list]) => list?.pages ?? [])
          .flatMap((page) => page.messages)
          .find((message) => message.id === data.messageId);
        onNewMailRef.current?.({
          inboxId: data.inboxId,
          messageId: data.messageId,
          summary,
        });
      });
    };

    const onInboxGone = (event: Event) => {
      const data = parse(event);
      if (!data) return;
      queryClient.setQueryData<Inbox[]>(INBOXES_KEY, (current) =>
        current?.filter((inbox) => inbox.id !== data.inboxId),
      );
      queryClient.removeQueries({ queryKey: ["messages", data.inboxId] });
      void queryClient.invalidateQueries({ queryKey: ["messages", "unified"] });
    };

    const connect = () => {
      const current = new EventSource("/api/events");
      source = current;
      current.onopen = () => {
        // Events sent while disconnected are not all replayed (deletions are not stored), so
        // after any reconnect refetch everything once.
        if (openedBefore) {
          void queryClient.invalidateQueries({ queryKey: INBOXES_KEY });
          void queryClient.invalidateQueries({ queryKey: ["messages"] });
        }
        openedBefore = true;
        failures = 0;
        setLiveStatus("live");
      };
      current.addEventListener("NEW_EMAIL", onNewEmail);
      current.addEventListener("INBOX_DELETED", onInboxGone);
      current.addEventListener("INBOX_EXPIRED", onInboxGone);
      current.onerror = () => {
        if (current.readyState !== EventSource.CLOSED) {
          // The browser is already reconnecting and will send Last-Event-ID.
          setLiveStatus("connecting");
          return;
        }
        current.close();
        setLiveStatus("offline");
        failures += 1;
        const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** failures);
        retryTimer = setTimeout(async () => {
          // A refused stream is usually an expired session; this request creates a new one.
          await api("GET", "/sessions/me").catch(() => undefined);
          if (!stopped) connect();
        }, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      source?.close();
      setLiveStatus("connecting");
    };
  }, [enabled, queryClient]);
}
