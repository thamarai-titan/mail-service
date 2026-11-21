import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/** Three honeycomb cells: a hive of inboxes. The bottom cell is the one in use. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-6 shrink-0 text-primary", className)}
      aria-hidden="true"
    >
      <path
        d="M6.82 2.80 L11.50 5.50 L11.50 10.90 L6.82 13.60 L2.15 10.90 L2.15 5.50 Z"
        fill="currentColor"
        fillOpacity=".45"
      />
      <path
        d="M17.18 2.80 L21.85 5.50 L21.85 10.90 L17.18 13.60 L12.50 10.90 L12.50 5.50 Z"
        fill="currentColor"
        fillOpacity=".45"
      />
      <path
        d="M12.00 11.75 L16.68 14.45 L16.68 19.85 L12.00 22.55 L7.32 19.85 L7.32 14.45 Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[19px] font-bold tracking-[-0.04em]">
        {BRAND.name}
      </span>
    </span>
  );
}
