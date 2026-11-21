"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  KEEP_FOR_HOURS,
  MAX_ACTIVE_INBOXES,
  MAX_LIFETIME_MS,
} from "@/hooks/use-inboxes";
import { useNow } from "@/hooks/use-now";
import { formatCountdown, formatUntil } from "@/lib/format";
import { quietButton, solidButton } from "@/lib/styles";
import type { Inbox } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { DeleteAddressDialog } from "./delete-address-dialog";

/** An inbox starts with an hour; the bar is full while at least that much is left. */
const FULL_BAR_MS = 60 * 60 * 1000;
export const LOW_TIME_MS = 5 * 60 * 1000;

interface Props {
  inbox: Inbox | null;
  /** 1-based position of this address among the live ones, for the ticket number. */
  number: number;
  isLoading: boolean;
  isCreating: boolean;
  isExtending: boolean;
  /** How many more addresses may be created right now (0 at the limit). */
  maxNew: number;
  error: string | null;
  onCreate: (count: number) => void;
  onKeepFor: (id: string, hours: number) => void;
  onDelete: (id: string) => void;
}

/**
 * The current address, drawn as a ticket: the address on the main part, the actions on a stub
 * behind a perforated tear line. A temp address is a ticket after all: valid until a time.
 */
export function AddressTicket({
  inbox,
  number,
  isLoading,
  isCreating,
  isExtending,
  maxNew,
  error,
  onCreate,
  onKeepFor,
  onDelete,
}: Props) {
  const now = useNow();
  const remainingMs = inbox ? Date.parse(inbox.expiresAt) - now : 0;
  // now is 0 during the server render; draw a full bar rather than an empty one.
  const fraction =
    now === 0 ? 1 : Math.min(1, Math.max(0, remainingMs / FULL_BAR_MS));
  const low = inbox !== null && now !== 0 && remainingMs < LOW_TIME_MS;

  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-[0_1px_0_0_rgb(255_255_255/0.04)_inset,0_10px_30px_-18px_rgb(0_0_0/0.5)] md:flex-row">
      <div className="min-w-0 flex-1 px-5 pt-4 pb-5 sm:px-6">
        <p className="flex items-center gap-3 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          <span>temp address</span>
          <span className="text-muted-foreground/60">
            no. {String(number).padStart(2, "0")}/{MAX_ACTIVE_INBOXES}
          </span>
          {inbox && now !== 0 && (
            <span
              className={cn("ml-auto hidden sm:inline", low && "text-warning")}
            >
              valid until {formatUntil(Date.parse(inbox.expiresAt))}
            </span>
          )}
        </p>

        <div className="mt-2 flex min-h-9 items-start gap-2">
          <div className="min-w-0 flex-1">
            {isLoading || (inbox === null && isCreating) ? (
              <Skeleton className="h-8 w-80 max-w-full" />
            ) : inbox ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={inbox.address}
                  initial={{ opacity: 0, y: 6, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -6, filter: "blur(6px)" }}
                  transition={{ duration: 0.22 }}
                  className="font-mono text-[22px] leading-9 font-medium tracking-tight [overflow-wrap:anywhere] sm:text-[28px]"
                >
                  {/* Narrow screens break the line after the @, not inside the domain. */}
                  {inbox.address.split("@")[0]}
                  <span className="text-muted-foreground">@</span>
                  <wbr />
                  <span className="whitespace-nowrap">
                    {inbox.address.split("@")[1]}
                  </span>
                </motion.p>
              </AnimatePresence>
            ) : (
              <p className="leading-9 text-muted-foreground">
                No active address. Make one to start receiving mail.
              </p>
            )}
          </div>
          {inbox && (
            <DeleteAddressDialog
              address={inbox.address}
              onConfirm={() => onDelete(inbox.id)}
            >
              <Button
                variant="ghost"
                size="icon"
                className="-mr-2 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${inbox.address}`}
              >
                <Trash2Icon />
              </Button>
            </DeleteAddressDialog>
          )}
        </div>

        <span className="mt-3 block h-[3px] overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-1000 ease-linear",
              low ? "bg-warning" : "bg-primary",
            )}
            style={{ width: `${inbox ? fraction * 100 : 0}%` }}
          />
        </span>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <Perforation />

      <div className="flex flex-col justify-center gap-2 px-5 py-4 sm:px-6 md:w-[330px] md:shrink-0">
        {inbox ? (
          <CopyButton
            value={inbox.address}
            label={`Copy ${inbox.address}`}
            className={cn("h-11 w-full text-[15px]", solidButton)}
          >
            {(copied) => (copied ? "Copied" : "Copy address")}
          </CopyButton>
        ) : (
          <Button
            className={cn("h-11 w-full text-[15px]", solidButton)}
            disabled={isCreating || maxNew < 1}
            onClick={() => onCreate(1)}
          >
            <PlusIcon />
            {isCreating ? "Making one…" : "Make an address"}
          </Button>
        )}
        {inbox && (
          <div className="flex gap-2">
            <KeepForMenu
              inbox={inbox}
              now={now}
              remainingMs={remainingMs}
              low={low}
              disabled={isExtending}
              onKeepFor={(hours) => onKeepFor(inbox.id, hours)}
            />
            <NewAddressMenu
              disabled={isCreating}
              maxNew={maxNew}
              onCreate={onCreate}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** The tear line between ticket and stub, with a punched notch at each end. */
function Perforation() {
  const notch = "absolute size-6 rounded-full border bg-background";
  return (
    <div aria-hidden="true" className="relative">
      <div className="mx-4 border-t-2 border-dashed border-border md:mx-0 md:my-4 md:h-[calc(100%-2rem)] md:border-t-0 md:border-l-2" />
      {/* Horizontal on phones (notches left and right), vertical from md (top and bottom). */}
      <span
        className={cn(
          notch,
          "top-1/2 -left-3 -translate-y-1/2 md:top-[-12px] md:left-1/2 md:-translate-x-1/2 md:translate-y-0",
        )}
      />
      <span
        className={cn(
          notch,
          "top-1/2 -right-3 -translate-y-1/2 md:top-auto md:right-auto md:bottom-[-12px] md:left-1/2 md:-translate-x-1/2 md:translate-y-0",
        )}
      />
    </div>
  );
}

/** The countdown is the button; the durations the backend accepts are the menu. */
function KeepForMenu({
  inbox,
  now,
  remainingMs,
  low,
  disabled,
  onKeepFor,
}: {
  inbox: Inbox;
  now: number;
  remainingMs: number;
  low: boolean;
  disabled: boolean;
  onKeepFor: (hours: number) => void;
}) {
  const expiresAt = Date.parse(inbox.expiresAt);
  const ceiling = Date.parse(inbox.createdAt) + MAX_LIFETIME_MS;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-10 flex-1 gap-1.5 px-3 font-mono text-[13px] tabular-nums",
            quietButton,
            low && "text-warning",
          )}
          disabled={disabled}
          aria-label="Keep this address longer"
        >
          <ClockIcon className={cn(low && "animate-pulse")} />
          {now === 0 ? "1:00:00" : formatCountdown(remainingMs)}
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Keep this address for</DropdownMenuLabel>
        {KEEP_FOR_HOURS.map((hours) => {
          const until = Math.min(now + hours * 3600_000, ceiling);
          // Already kept at least this long: choosing it would change nothing.
          const current = until <= expiresAt + 60_000;
          const capped = now + hours * 3600_000 > ceiling;
          return (
            <DropdownMenuItem
              key={hours}
              disabled={current}
              onSelect={() => onKeepFor(hours)}
              className="justify-between"
            >
              <span className="flex items-center gap-2">
                {current ? (
                  <CheckIcon className="size-3.5" />
                ) : (
                  <span className="size-3.5" />
                )}
                {hours === 1 ? "1 hour" : `${hours} hours`}
              </span>
              <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                {capped ? "max · " : ""}
                {formatUntil(until)}
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          An address lives at most 24 hours. Until {formatUntil(ceiling)} for
          this one.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NewAddressMenu({
  disabled,
  maxNew,
  onCreate,
}: {
  disabled: boolean;
  maxNew: number;
  onCreate: (count: number) => void;
}) {
  return (
    <div className="flex flex-1">
      <Button
        variant="ghost"
        className={cn("h-10 flex-1 rounded-r-none px-3", quietButton)}
        disabled={disabled || maxNew < 1}
        onClick={() => onCreate(1)}
      >
        <PlusIcon />
        New
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className={cn("h-10 rounded-l-none border-l-0 px-1.5", quietButton)}
            disabled={disabled || maxNew < 2}
            aria-label="Make several addresses at once"
          >
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Make several at once</DropdownMenuLabel>
          {Array.from({ length: Math.max(0, maxNew - 1) }, (_, i) => i + 2).map(
            (count) => (
              <DropdownMenuItem key={count} onSelect={() => onCreate(count)}>
                {count} addresses
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
