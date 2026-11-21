"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import {
  MAX_ACTIVE_INBOXES,
  MAX_PER_REQUEST,
  useCreateInboxes,
  useDeleteInbox,
  useExtendInbox,
  useInboxes,
} from "@/hooks/use-inboxes";
import { type NewMail, useLiveUpdates } from "@/hooks/use-live-updates";
import { useMessages } from "@/hooks/use-messages";
import { useNow } from "@/hooks/use-now";
import { BRAND } from "@/lib/brand";
import { formatUntil } from "@/lib/format";
import type { Inbox, InboxView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AddressChips } from "./app/address-chips";
import { AddressTicket } from "./app/address-ticket";
import { EmailViewer } from "./app/email-viewer";
import { Frame } from "./app/frame";
import { MessageList } from "./app/message-list";
import { TopBar } from "./app/top-bar";

const WIDE_SCREEN = "(min-width: 768px)";

export function Dashboard() {
  const inboxesQuery = useInboxes();
  const create = useCreateInboxes();
  const extend = useExtendInbox();
  const remove = useDeleteInbox();
  const notifications = useBrowserNotifications();
  const now = useNow();

  const [selectedView, setSelectedView] = useState<InboxView>("unified");
  const [messageId, setMessageId] = useState<string | null>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);
  // While the ticket is out of view the address rides along in the top bar.
  const [ticketVisible, setTicketVisible] = useState(true);
  useEffect(() => {
    const ticket = ticketRef.current;
    if (!ticket) return;
    const observer = new IntersectionObserver(
      ([entry]) => setTicketVisible(entry?.isIntersecting ?? true),
      // The sticky top bar covers the first 64px.
      { rootMargin: "-64px 0px 0px 0px" },
    );
    observer.observe(ticket);
    return () => observer.disconnect();
  }, []);

  // The server is the authority on expiry; this only stops a dead address lingering between events.
  const inboxes = (inboxesQuery.data ?? []).filter(
    (inbox) => now === 0 || Date.parse(inbox.expiresAt) > now,
  );
  // A selected inbox can expire or be deleted underneath us: fall back to the unified view.
  const selectedInbox = inboxes.find((inbox) => inbox.id === selectedView);
  const view: InboxView = selectedInbox ? selectedInbox.id : "unified";
  // The panel shows the selected address, or the newest one in the unified view.
  const currentInbox: Inbox | null = selectedInbox ?? inboxes[0] ?? null;
  const maxNew = Math.min(MAX_PER_REQUEST, MAX_ACTIVE_INBOXES - inboxes.length);
  const totalUnread = inboxes.reduce(
    (sum, inbox) => sum + inbox.unreadCount,
    0,
  );

  // The same list the message pane shows (React Query shares it), for keyboard navigation.
  const messagesQuery = useMessages(view);
  const messages =
    messagesQuery.data?.pages.flatMap((page) => page.messages) ?? [];
  const listUnread = messages.filter((message) => !message.isRead).length;

  const selectView = (next: InboxView) => {
    setSelectedView(next);
    setMessageId(null);
  };

  /**
   * Opens a message. The inbox then splits into list and email and fills the screen, so it is
   * scrolled to the top; mail that opens by itself does not move the page.
   */
  const openMessage = (id: string, scroll = true) => {
    setMessageId(id);
    if (scroll) {
      requestAnimationFrame(() =>
        appRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  };

  const createInboxes = (count: number, select = true) =>
    create.mutate(count, {
      onSuccess: (created) => {
        const newest = created[0];
        if (select && newest) selectView(newest.id);
        toast.success(
          count > 1
            ? `${created.length} new addresses ready`
            : `New address ready: ${newest?.address ?? ""}`,
        );
      },
      onError: (error) => toast.error(error.message),
    });

  // First visit: hand the visitor an address straight away instead of an empty page.
  const autoCreated = useRef(false);
  useEffect(() => {
    if (
      inboxesQuery.isSuccess &&
      inboxesQuery.data.length === 0 &&
      !autoCreated.current
    ) {
      autoCreated.current = true;
      create.mutate(1, { onError: (error) => toast.error(error.message) });
    }
  }, [inboxesQuery.isSuccess, inboxesQuery.data, create]);

  // Unread count in the tab title, so new mail is visible from other tabs.
  useEffect(() => {
    document.title =
      totalUnread > 0
        ? `(${totalUnread}) New mail · ${BRAND.name}`
        : BRAND.title;
  }, [totalUnread]);

  const onNewMail = ({ inboxId, messageId: newId, summary }: NewMail) => {
    const address =
      inboxes.find((inbox) => inbox.id === inboxId)?.address ?? "your inbox";
    const from = summary ? (summary.fromName ?? summary.fromAddress) : null;
    const title = from ? `New mail from ${from}` : "New mail arrived";
    const description = summary?.otpCode
      ? `Code ${summary.otpCode} · ${summary.subject ?? "(no subject)"}`
      : (summary?.subject ?? `Sent to ${address}`);
    const otp = summary?.otpCode;

    // Nothing open on a wide screen: show the new mail right away, it is what they came for.
    if (
      summary &&
      messageId === null &&
      window.matchMedia(WIDE_SCREEN).matches
    ) {
      openMessage(summary.id, false);
    }

    toast(title, {
      description,
      action: otp
        ? {
            label: "Copy code",
            onClick: () => {
              void navigator.clipboard.writeText(otp).then(
                () => toast.success(`Copied ${otp}`),
                () => undefined,
              );
            },
          }
        : newId
          ? { label: "Open", onClick: () => openMessage(newId) }
          : undefined,
    });
    notifications.notify(title, description);
  };

  useLiveUpdates(inboxesQuery.isSuccess, onNewMail);

  const keepFor = (id: string, hours: number) =>
    extend.mutate(
      { id, hours },
      {
        onSuccess: (inbox) =>
          toast.success(
            `Kept until ${formatUntil(Date.parse(inbox.expiresAt))}`,
          ),
        onError: (error) => toast.error(error.message),
      },
    );
  const deleteInbox = (id: string) =>
    remove.mutate(id, {
      onSuccess: () => toast.success("Address deleted"),
      onError: (error) => toast.error(error.message),
    });

  // Keyboard shortcuts for the things done every day: move through mail, copy, start over.
  const shortcuts = useRef<(event: KeyboardEvent) => void>(() => undefined);
  shortcuts.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      target?.closest(
        "input, textarea, select, [contenteditable], [role=dialog], [role=menu]",
      )
    ) {
      return;
    }
    const index = messages.findIndex((message) => message.id === messageId);
    const copy = (text: string, done: string) =>
      void navigator.clipboard.writeText(text).then(
        () => toast.success(done),
        () => undefined,
      );

    switch (event.key) {
      case "j":
      case "ArrowDown": {
        const next =
          messages[index + 1] ?? (index === -1 ? messages[0] : undefined);
        if (next) openMessage(next.id);
        break;
      }
      case "k":
      case "ArrowUp": {
        const previous = messages[index - 1];
        if (previous) openMessage(previous.id);
        break;
      }
      case "c":
        if (currentInbox) copy(currentInbox.address, "Address copied");
        break;
      case "y": {
        const code = messages[index]?.otpCode ?? messages[0]?.otpCode;
        if (code) copy(code, `Copied ${code}`);
        break;
      }
      case "n":
        if (maxNew > 0 && !create.isPending) createInboxes(1);
        break;
      case "Escape":
        setMessageId(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => shortcuts.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isOpen = messageId !== null;
  const position = currentInbox
    ? inboxes.findIndex((inbox) => inbox.id === currentInbox.id) + 1
    : 0;

  return (
    <>
      <TopBar
        stickyAddress={ticketVisible ? null : (currentInbox?.address ?? null)}
        notifications={notifications}
      />
      {/* A faint warm glow behind the top of the page, the only colour wash on it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(50%_60%_at_20%_0%,color-mix(in_oklch,var(--primary)_11%,transparent),transparent)]"
      />
      <main className="mx-auto w-full max-w-[1400px] px-3 pt-5 sm:px-6 sm:pt-7">
        <header>
          <h1 className="text-[15px] font-semibold tracking-tight">
            Temp mail for testers
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Up to {MAX_ACTIVE_INBOXES} disposable addresses in one live inbox.
            Codes and verification links land in a second.
          </p>
        </header>

        <div ref={ticketRef} className="mt-4">
          <AddressTicket
            inbox={currentInbox}
            number={Math.max(position, 1)}
            isLoading={inboxesQuery.isPending}
            isCreating={create.isPending}
            isExtending={extend.isPending}
            maxNew={maxNew}
            error={inboxesQuery.error?.message ?? null}
            onCreate={(count) => createInboxes(count)}
            onKeepFor={keepFor}
            onDelete={deleteInbox}
          />
        </div>

        {inboxes.length > 1 && (
          <div className="mt-4">
            <AddressChips
              inboxes={inboxes}
              view={view}
              onSelectView={selectView}
            />
          </div>
        )}

        <div ref={appRef} className="mt-7 scroll-mt-[4.5rem]">
          <Frame
            // One height in every state (waiting, receiving, reading), so nothing below moves.
            className="h-[max(520px,calc(100dvh-6rem))]"
            label={
              <>
                inbox <span className="text-muted-foreground/50">/</span>{" "}
                {selectedInbox ? selectedInbox.address : "all addresses"}
              </>
            }
            aside={
              messages.length > 0 && (
                <span className="flex shrink-0 items-center gap-1.5">
                  {listUnread > 0 && (
                    <>
                      <span className="size-1.5 rounded-full bg-primary" />
                      <span className="text-foreground">{listUnread} new</span>
                      <span className="text-muted-foreground/50">·</span>
                    </>
                  )}
                  {messages.length}
                  {messagesQuery.hasNextPage ? "+" : ""}
                </span>
              )
            }
            innerClassName={cn(
              "grid grid-cols-[minmax(0,1fr)] overflow-hidden",
              isOpen && "md:grid-cols-[minmax(300px,36%)_minmax(0,1fr)]",
            )}
          >
            <MessageList
              view={view}
              wide={!isOpen}
              showInboxAddress={view === "unified" && inboxes.length > 1}
              waitingAddress={currentInbox?.address ?? null}
              selectedMessageId={messageId}
              onSelectMessage={(id) => openMessage(id)}
              className={cn(isOpen && "hidden md:flex md:border-r")}
            />
            {isOpen && (
              <EmailViewer
                messageId={messageId}
                onClose={() => setMessageId(null)}
                className="min-h-[70dvh] md:min-h-0"
              />
            )}
          </Frame>
        </div>
      </main>
    </>
  );
}
