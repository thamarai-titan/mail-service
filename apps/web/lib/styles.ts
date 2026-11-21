/**
 * Finishes for solid buttons: a hairline top highlight and a tight shadow make them read as
 * pressed-out objects instead of flat fills.
 */
export const solidButton =
  "border border-black/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_1px_2px_rgb(0_0_0/0.25)] active:scale-[0.98] dark:border-white/10";

export const quietButton =
  "border-input bg-card shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_1px_2px_rgb(0_0_0/0.06)] hover:bg-accent active:scale-[0.98]";
