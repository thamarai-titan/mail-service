"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "./query-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <QueryProvider>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster position="bottom-right" richColors={false} closeButton />
        </TooltipProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
