"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";

type Props = Omit<ComponentProps<typeof Button>, "onClick" | "children"> & {
  value: string;
  /** Accessible name before copying, e.g. "Copy address". */
  label: string;
  /** Visible text; a function receives whether the value was just copied. */
  children?: ReactNode | ((copied: boolean) => ReactNode);
};

/** A button that copies `value`, with the copy icon springing into a check mark. */
export function CopyButton({ value, label, children, ...props }: Props) {
  const { copied, copy } = useCopy();
  return (
    <Button
      {...props}
      aria-label={copied ? "Copied" : label}
      onClick={(event) => {
        event.stopPropagation();
        void copy(value);
      }}
    >
      <span className="relative inline-flex size-4 items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={copied ? "check" : "copy"}
            className="inline-flex"
            initial={{ scale: 0.3, opacity: 0, rotate: -45 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.3, opacity: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 26 }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </motion.span>
        </AnimatePresence>
      </span>
      {typeof children === "function" ? children(copied) : children}
    </Button>
  );
}
