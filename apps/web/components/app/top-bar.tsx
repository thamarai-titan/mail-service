"use client";

import {
  BellIcon,
  BellOffIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLiveStatus } from "@/lib/live-status";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { Logo, LogoMark } from "./logo";

interface Props {
  /** Shown in the bar once the address ticket has scrolled out of view. */
  stickyAddress: string | null;
  notifications: {
    supported: boolean;
    enabled: boolean;
    blocked: boolean;
    toggle: () => Promise<void>;
  };
}

export function TopBar({ stickyAddress, notifications }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
        <a
          href="/"
          aria-label="Home"
          className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {/* On a phone the wordmark makes room for the address once it is pinned here. */}
          <Logo className={cn(stickyAddress && "hidden sm:flex")} />
          {stickyAddress && <LogoMark className="sm:hidden" />}
        </a>
        <AnimatePresence initial={false}>
          {stickyAddress && (
            <motion.div
              key="sticky-address"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="flex min-w-0 items-center gap-1 rounded-lg border bg-card py-1 pr-1 pl-3 sm:ml-6"
            >
              <span className="min-w-0 truncate font-mono text-[13px]">
                {stickyAddress}
              </span>
              <CopyButton
                value={stickyAddress}
                label={`Copy ${stickyAddress}`}
                variant="ghost"
                size="icon-sm"
              />
            </motion.div>
          )}
        </AnimatePresence>
        <nav
          aria-label="Sections"
          className={cn(
            "ml-8 hidden items-center gap-7 text-[15px] text-muted-foreground md:flex",
            stickyAddress && "md:hidden xl:flex",
          )}
        >
          <a href="#how" className="transition-colors hover:text-foreground">
            How it works
          </a>
          <a
            href="#features"
            className="transition-colors hover:text-foreground"
          >
            Features
          </a>
          <a href="#faq" className="transition-colors hover:text-foreground">
            FAQ
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <LivePill />
          {notifications.supported && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-pressed={notifications.enabled}
                  aria-label={
                    notifications.enabled
                      ? "Turn off desktop notifications"
                      : "Turn on desktop notifications"
                  }
                  onClick={() => void notifications.toggle()}
                  className={cn(notifications.enabled && "text-primary")}
                >
                  {notifications.enabled ? <BellIcon /> : <BellOffIcon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {notifications.blocked
                  ? "Notifications are blocked in your browser settings"
                  : notifications.enabled
                    ? "Desktop alerts on"
                    : "Alert me when mail arrives in another tab"}
              </TooltipContent>
            </Tooltip>
          )}
          <ThemeMenu />
        </div>
      </div>
    </header>
  );
}

/** A small signal meter: bars that move while mail can arrive live, flat while reconnecting. */
function LivePill() {
  const status = useLiveStatus();
  const live = status === "live";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          className="flex h-8 items-center gap-2 rounded-md px-2 font-mono text-[11px] text-muted-foreground"
        >
          <span className="flex h-3.5 items-end gap-[2px]" aria-hidden="true">
            {[0, 1, 2, 3].map((bar) => (
              <span
                key={bar}
                className={cn(
                  "w-[2px] origin-bottom rounded-full",
                  live ? "h-full animate-wave bg-live" : "h-1 bg-warning",
                )}
                style={live ? { animationDelay: `${bar * 0.15}s` } : undefined}
              />
            ))}
          </span>
          {live
            ? "receiving"
            : status === "connecting"
              ? "connecting"
              : "reconnecting"}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {live
          ? "Connected: new mail appears the moment it arrives"
          : "Reconnecting; checking for mail every 30 seconds meanwhile"}
      </TooltipContent>
    </Tooltip>
  );
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Theme"
              className="relative"
            >
              <SunIcon className="scale-100 rotate-0 transition-transform duration-300 dark:scale-0 dark:-rotate-90" />
              <MoonIcon className="absolute scale-0 rotate-90 transition-transform duration-300 dark:scale-100 dark:rotate-0" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Theme</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <SunIcon /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
