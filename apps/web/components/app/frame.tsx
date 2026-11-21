import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A panel set inside a slightly darker shell, with an optional monospace label on the shell.
 * The double edge is what gives the layout its depth without shadows or gradients.
 */
export function Frame({
  label,
  aside,
  className,
  innerClassName,
  children,
}: {
  label?: ReactNode;
  /** Right-hand side of the label row. */
  aside?: ReactNode;
  className?: string;
  innerClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-[22px] border bg-frame p-1.5 shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset]",
        className,
      )}
    >
      {(label || aside) && (
        <div className="flex min-h-8 items-center justify-between gap-3 px-3 pt-0.5 pb-1.5 font-mono text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{label}</span>
          {aside}
        </div>
      )}
      <div
        className={cn(
          "min-h-0 flex-1 rounded-2xl border bg-card",
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
