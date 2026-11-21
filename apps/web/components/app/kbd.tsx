import type { ReactNode } from "react";

/** A key cap: a hairline border with a thicker bottom edge, like the real thing. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-b-[2.5px] bg-card px-1 font-mono text-[10px] leading-none text-foreground">
      {children}
    </kbd>
  );
}
