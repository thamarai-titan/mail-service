"use client";

import { useEffect, useRef } from "react";
import { useNow } from "@/hooks/use-now";
import { formatCountdown } from "@/lib/format";
import type { Inbox, InboxView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LOW_TIME_MS } from "./address-ticket";
import { MAX_ACTIVE_INBOXES } from "@/hooks/use-inboxes";
import { CopyButton } from "./copy-button";
import { Frame } from "./frame";

/**
 * Every address as a chip, for anyone juggling several (testing a sign-up flow ten times over).
 * Picking a chip shows that address on the ticket and filters the inbox to it.
 */
export function AddressChips({
  inboxes,
  view,
  onSelectView,
}: {
  inboxes: Inbox[];
  view: InboxView;
  onSelectView: (view: InboxView) => void;
}) {
  const now = useNow();
  const stripRef = useRef<HTMLDivElement>(null);
  // A mouse wheel only scrolls up and down; turn it sideways while over the strip.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      const room = strip.scrollWidth - strip.clientWidth;
      if (room <= 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const atEnd =
        (event.deltaY < 0 && strip.scrollLeft <= 0) ||
        (event.deltaY > 0 && strip.scrollLeft >= room - 1);
      if (atEnd) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);
  const totalUnread = inboxes.reduce(
    (sum, inbox) => sum + inbox.unreadCount,
    0,
  );

  return (
    <Frame
      label={
        <>
          your addresses{" "}
          <span className="text-muted-foreground/60">
            {inboxes.length}/{MAX_ACTIVE_INBOXES}
          </span>
        </>
      }
      aside={
        <CopyButton
          value={inboxes.map((inbox) => inbox.address).join("\n")}
          label={`Copy all ${inboxes.length} addresses`}
          variant="ghost"
          size="xs"
          className="-my-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          {(copied) => (copied ? "copied" : `copy all ${inboxes.length}`)}
        </CopyButton>
      }
    >
      {/* One straight line: "All inboxes" stays put, the addresses scroll sideways. */}
      <div
        role="tablist"
        aria-label="Addresses"
        className="flex items-center gap-2 p-3"
      >
        <Chip
          selected={view === "unified"}
          onClick={() => onSelectView("unified")}
        >
          All inboxes
          {totalUnread > 0 && <Count>{totalUnread}</Count>}
        </Chip>
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
        <div
          ref={stripRef}
          className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] pr-8"
        >
          {inboxes.map((inbox) => {
            const remaining = Date.parse(inbox.expiresAt) - now;
            const low = now !== 0 && remaining < LOW_TIME_MS;
            return (
              <Chip
                key={inbox.id}
                selected={view === inbox.id}
                onClick={() => onSelectView(inbox.id)}
                title={inbox.address}
              >
                <span className="min-w-0 truncate font-mono">
                  {inbox.address.split("@")[0]}
                </span>
                <span
                  className={cn(
                    "font-mono text-[11px] tabular-nums",
                    low ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  {now === 0 ? "" : formatCountdown(remaining)}
                </span>
                {inbox.unreadCount > 0 && <Count>{inbox.unreadCount}</Count>}
              </Chip>
            );
          })}
        </div>
      </div>
    </Frame>
  );
}

function Chip({
  selected,
  onClick,
  title,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      title={title}
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2.5 rounded-xl border px-3.5 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected
          ? "border-primary/50 bg-primary/15 text-foreground"
          : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] leading-4 text-primary-foreground">
      {children}
    </span>
  );
}
