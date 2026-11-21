import type { CSSProperties } from "react";
import { senderHue, senderInitials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/** Round initials in a colour that stays the same for each sender. */
export function SenderAvatar({
  name,
  address,
  className,
}: {
  name: string | null;
  address: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ "--h": senderHue(address) } as CSSProperties}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        "bg-[oklch(0.94_0.025_var(--h))] text-[oklch(0.4_0.08_var(--h))]",
        "dark:bg-[oklch(0.27_0.03_var(--h))] dark:text-[oklch(0.86_0.05_var(--h))]",
        className,
      )}
    >
      {senderInitials(name, address)}
    </span>
  );
}
